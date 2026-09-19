import { FrameSignal } from '../../domain/alignment/alignment.types';
import { DEFAULT_SEGMENTER_OPTIONS, segment } from './segmenter';

/**
 * Construit un signal d'une game : HUD allumé sur `[gameFrom, gameTo)`, et
 * canal noir élevé sur les intervalles `sombres`.
 */
function signal(
  length: number,
  gameFrom: number,
  gameTo: number,
  sombres: Array<[number, number]>,
): FrameSignal {
  const hud = new Uint8Array(length);
  for (let i = gameFrom; i < gameTo; i++) hud[i] = Math.round(0.3 * 255);
  const dark = new Uint8Array(length).fill(Math.round(0.05 * 255));
  for (const [from, to] of sombres) {
    for (let i = from; i < to; i++) dark[i] = Math.round(0.8 * 255);
  }
  return { sampleRate: 1, startSeconds: 0, hud, dark };
}

const options = { ...DEFAULT_SEGMENTER_OPTIONS, darkThreshold: 0.4 as const };

describe('segment, recalage du début sur le fondu', () => {
  it('recale le début sur le fondu qui précède la game', () => {
    // Fondu de 4 s juste avant la game : il fait partie de l'entrée en jeu.
    const s = signal(2000, 500, 900, [[496, 500]]);

    const [game] = segment(s, options);

    expect(game.startSeconds).toBe(496);
    expect(game.snappedToBlack).toBe(true);
  });

  it('ne remonte pas toute une intermission prise pour un fondu', () => {
    // 300 s sombres collés à la game : un écran d'attente, pas un fondu. Sans
    // borne, le début reculait de tout le lookback et le clip s'ouvrait une
    // minute avant le set.
    const s = signal(2000, 800, 1200, [[500, 800]]);

    const [game] = segment(s, options);

    // Le dernier échantillon sombre est à 799 : on ne traverse au plus que
    // `maxFadeSeconds` de ce bloc, au lieu de remonter jusqu'à 500.
    expect(game.startSeconds).toBeGreaterThanOrEqual(799 - options.maxFadeSeconds);
  });

  it('ne saute pas par-dessus un character select pour atteindre un fondu', () => {
    // Fondu 30 s avant la game, séparé d'elle par une image claire : c'est la
    // transition vers le character select, pas l'entrée en jeu.
    const s = signal(2000, 800, 1200, [[766, 770]]);

    const [game] = segment(s, options);

    expect(game.startSeconds).toBe(800);
    expect(game.snappedToBlack).toBe(false);
  });

  it('accepte encore un fondu situé dans la fenêtre de recherche', () => {
    // 10 s avant la game, donc sous blackLookbackSeconds.
    const s = signal(2000, 800, 1200, [[786, 790]]);

    const [game] = segment(s, options);

    expect(game.startSeconds).toBe(786);
  });
});
