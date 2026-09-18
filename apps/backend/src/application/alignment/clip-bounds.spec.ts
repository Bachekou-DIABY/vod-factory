import {
  AlignedSet,
  FrameSignal,
  GameCandidate,
} from '../../domain/alignment/alignment.types';
import {
  DEFAULT_CLIP_BOUNDS_OPTIONS,
  inGameDarkness,
  preRollBefore,
  trimDeadPreRoll,
} from './clip-bounds';

const SEUIL = 0.25;

/**
 * Signal dont le canal noir vaut 0.05 partout, sauf sur les intervalles
 * `morts` où il vaut 0.6 — un écran d'attente ou un fondu.
 */
function signal(length: number, morts: Array<[number, number]>): FrameSignal {
  const dark = new Uint8Array(length).fill(Math.round(0.05 * 255));
  for (const [from, to] of morts) {
    for (let i = from; i < to; i++) dark[i] = Math.round(0.6 * 255);
  }
  return { sampleRate: 1, startSeconds: 0, hud: new Uint8Array(length), dark };
}

function game(startSeconds: number, endSeconds: number): GameCandidate {
  return {
    startSeconds,
    endSeconds,
    confidence: 1,
    snappedToBlack: true,
    ocrConfirmed: null,
  };
}

function alignedSet(games: GameCandidate[], startSeconds: number): AlignedSet {
  return {
    set: {
      setStartGGId: 's',
      roundName: 'R',
      players: 'A vs B',
      gameCount: games.length,
      minGames: games.length,
      maxGames: games.length,
    } as AlignedSet['set'],
    games,
    source: 'video',
    confidence: 1,
    warnings: [],
    startSeconds,
    endSeconds: games.length ? games[games.length - 1].endSeconds + 20 : startSeconds,
  };
}

describe('preRollBefore', () => {
  it('garde toute la marge quand l image est vivante avant la game', () => {
    const s = signal(1000, []);

    expect(preRollBefore(s, 500, SEUIL)).toBe(25);
  });

  it('tolère le fondu qui précède immédiatement chaque game', () => {
    // 6 s de noir colle a la game : c'est le fondu d'entree, pas une coupure.
    const s = signal(1000, [[494, 500]]);

    expect(preRollBefore(s, 500, SEUIL)).toBe(25);
  });

  it('ramène le recul au minimum quand le set suit un écran d attente', () => {
    // 200 s morts collés à la game : intermission, pas fondu.
    const s = signal(1000, [[300, 500]]);

    expect(preRollBefore(s, 500, SEUIL)).toBe(
      DEFAULT_CLIP_BOUNDS_OPTIONS.fadeAllowanceSeconds,
    );
  });

  it('démarre juste après le dernier bloc mort', () => {
    // Bloc mort de 485 à 490, donc vivant à partir de 490 : recul de 10 s.
    const s = signal(1000, [[485, 490]]);

    expect(preRollBefore(s, 500, SEUIL)).toBe(10);
  });

  it('ignore un clignotement trop court pour être une coupure', () => {
    // 2 s seulement, sous minDeadRunSeconds : ce n'est pas une intermission.
    const s = signal(1000, [[486, 488]]);

    expect(preRollBefore(s, 500, SEUIL)).toBe(25);
  });

  it('retient le bloc mort le plus proche de la game', () => {
    const s = signal(1000, [
      [478, 483],
      [488, 493],
    ]);

    expect(preRollBefore(s, 500, SEUIL)).toBe(7);
  });

  it('ne recule pas avant le début du signal', () => {
    const s = signal(1000, []);

    expect(preRollBefore(s, 8, SEUIL)).toBe(8);
  });
});

describe('inGameDarkness', () => {
  it('mesure la noirceur pendant le jeu, pas sur toute la VOD', () => {
    // Les trois quarts du signal sont morts : une médiane globale vaudrait 0.6.
    const s = signal(1000, [[0, 400], [600, 1000]]);
    const aligned = [alignedSet([game(400, 600)], 375)];

    expect(inGameDarkness(s, aligned)).toBeCloseTo(0.05, 2);
  });

  it('renvoie 0 quand aucune game n est alignée', () => {
    expect(inGameDarkness(signal(100, []), [])).toBe(0);
  });
});

describe('trimDeadPreRoll', () => {
  it('recale le début sans toucher aux games ni à la fin', () => {
    const s = signal(1000, [[300, 500]]);
    const aligned = [alignedSet([game(500, 700)], 475)];

    const [recalé] = trimDeadPreRoll(s, aligned);

    expect(recalé.startSeconds).toBe(490);
    expect(recalé.endSeconds).toBe(aligned[0].endSeconds);
    expect(recalé.games).toBe(aligned[0].games);
  });

  it('laisse intact un set replié sur les horodatages API', () => {
    const s = signal(1000, [[300, 500]]);
    const sansGames = alignedSet([], 480);
    const aligned = [alignedSet([game(500, 700)], 475), sansGames];

    expect(trimDeadPreRoll(s, aligned)[1]).toBe(sansGames);
  });

  it('ne fait rien quand il n y a aucune game pour calibrer le seuil', () => {
    const aligned = [alignedSet([], 100)];

    expect(trimDeadPreRoll(signal(1000, []), aligned)).toBe(aligned);
  });
});
