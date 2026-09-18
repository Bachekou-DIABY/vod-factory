import { FrameSignal, GameCandidate } from '../../domain/alignment/alignment.types';
import {
  DEFAULT_SPLITTER_OPTIONS,
  findSplitSecond,
  splitToMatchCount,
} from './game-splitter';

/**
 * Signal synthétique : noirceur de fond faible, et des creux marqués aux
 * secondes indiquées, comme un fondu entre deux games.
 */
function signal(length: number, fondus: number[], profondeur = 0.5): FrameSignal {
  const dark = new Uint8Array(length).fill(Math.round(0.03 * 255));
  for (const t of fondus) {
    for (let i = t - 3; i <= t + 3; i++) {
      if (i >= 0 && i < length) dark[i] = Math.round(profondeur * 255);
    }
  }
  return { sampleRate: 1, startSeconds: 0, hud: new Uint8Array(length), dark };
}

function game(startSeconds: number, endSeconds: number): GameCandidate {
  return {
    startSeconds,
    endSeconds,
    confidence: 0.9,
    snappedToBlack: true,
    ocrConfirmed: null,
  };
}

describe('findSplitSecond', () => {
  it('coupe au creux de noirceur le plus marqué', () => {
    const s = signal(1000, [400]);

    expect(findSplitSecond(s, 100, 700)).toBeCloseTo(400, -1);
  });

  it('refuse de couper trop près des bords', () => {
    // Le seul fondu est à 20 s du début, sous la marge de 40 s.
    const s = signal(1000, [120]);

    expect(findSplitSecond(s, 100, 300)).toBeNull();
  });

  it('refuse de couper quand aucun creux ne se détache du fond', () => {
    const s = signal(1000, []);

    expect(findSplitSecond(s, 100, 700)).toBeNull();
  });

  it('refuse un intervalle trop court pour donner deux games', () => {
    // 70 s, contre 80 s nécessaires pour deux moitiés de 40 s.
    const s = signal(1000, [135]);

    expect(findSplitSecond(s, 100, 170)).toBeNull();
  });
});

describe('splitToMatchCount', () => {
  it('sépare une game recollée quand le score en annonce une de plus', () => {
    const s = signal(1000, [400]);

    const resultat = splitToMatchCount([game(100, 700)], s, 2);

    expect(resultat).toHaveLength(2);
    expect(resultat[0].endSeconds).toBe(resultat[1].startSeconds);
    expect(resultat[0].startSeconds).toBe(100);
    expect(resultat[1].endSeconds).toBe(700);
  });

  it('coupe toujours la plus longue en premier', () => {
    const s = signal(2000, [500, 1400]);

    // 200 s et 800 s : c'est la seconde qui doit être coupée.
    const resultat = splitToMatchCount([game(100, 300), game(1000, 1800)], s, 3);

    expect(resultat).toHaveLength(3);
    expect(resultat[0]).toEqual(game(100, 300));
  });

  it('abaisse la confiance des moitiés, qui sont déduites et non détectées', () => {
    const s = signal(1000, [400]);

    const resultat = splitToMatchCount([game(100, 700)], s, 2);

    expect(resultat[0].confidence).toBeLessThan(0.9);
  });

  it('renonce plutôt que d inventer une game sans transition crédible', () => {
    const s = signal(1000, []);

    const resultat = splitToMatchCount([game(100, 700)], s, 2);

    expect(resultat).toHaveLength(1);
  });

  it('ne touche à rien quand le compte est déjà bon', () => {
    const s = signal(1000, [400]);
    const games = [game(100, 300), game(400, 700)];

    expect(splitToMatchCount(games, s, 2)).toEqual(games);
  });
});
