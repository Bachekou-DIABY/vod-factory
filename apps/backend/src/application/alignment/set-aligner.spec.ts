import { ExpectedSet, GameCandidate } from '../../domain/alignment/alignment.types';
import { AlignerOptions, DEFAULT_ALIGNER_OPTIONS, alignSets } from './set-aligner';
import { estimateBias } from './offset-estimator';
import { DEFAULT_SEGMENTER_OPTIONS, segment } from './segmenter';
import { filterSetsToVodWindow } from './vod-window';

const RECORDED_AT = 1_700_000_000;

function options(overrides: Partial<AlignerOptions> = {}): AlignerOptions {
  return {
    ...DEFAULT_ALIGNER_OPTIONS,
    biasSeconds: 0,
    recordedAtUnix: RECORDED_AT,
    vodDurationSeconds: 20_000,
    ...overrides,
  };
}

function makeSet(
  index: number,
  gameCount: number | null,
  startOffset: number,
  endOffset: number,
): ExpectedSet {
  return {
    setStartGGId: `set-${index}`,
    roundName: `Round ${index}`,
    players: `A${index} vs B${index}`,
    score: gameCount === null ? undefined : `A${index} ${gameCount} - 0 B${index}`,
    apiStartUnix: RECORDED_AT + startOffset,
    apiEndUnix: RECORDED_AT + endOffset,
    gameCount,
    minGames: gameCount ?? 2,
    maxGames: gameCount ?? 5,
  };
}

function makeGames(starts: number[], duration = 200): GameCandidate[] {
  return starts.map((start) => ({
    startSeconds: start,
    endSeconds: start + duration,
    confidence: 0.9,
    snappedToBlack: true,
    ocrConfirmed: null,
  }));
}

describe('alignSets', () => {
  it('attribue à chaque set le nombre de games annoncé par son score', () => {
    const sets = [makeSet(1, 2, 100, 700), makeSet(2, 3, 900, 1700)];
    // 2 games pour le set 1, 3 pour le set 2.
    const candidates = makeGames([120, 400, 950, 1250, 1550]);

    const aligned = alignSets(sets, candidates, options());

    expect(aligned[0].games.map((g) => g.startSeconds)).toEqual([120, 400]);
    expect(aligned[1].games.map((g) => g.startSeconds)).toEqual([950, 1250, 1550]);
    expect(aligned.every((a) => a.source === 'video')).toBe(true);
  });

  it('écarte un faux positif intercalé plutôt que de fausser le comptage', () => {
    const sets = [makeSet(1, 2, 100, 700), makeSet(2, 2, 2000, 2600)];
    // La game à 1200s ne colle ni au set 1 ni au set 2 : bracket ou caméra plateau.
    const candidates = makeGames([120, 400, 1200, 2050, 2350]);

    const aligned = alignSets(sets, candidates, options());

    expect(aligned[0].games.map((g) => g.startSeconds)).toEqual([120, 400]);
    expect(aligned[1].games.map((g) => g.startSeconds)).toEqual([2050, 2350]);
  });

  it('signale un set partiel quand il manque une game', () => {
    const sets = [makeSet(1, 3, 100, 900)];
    const candidates = makeGames([120, 400]);

    const aligned = alignSets(sets, candidates, options());

    expect(aligned[0].source).toBe('video-partial');
    expect(aligned[0].warnings[0]).toContain('3 game(s)');
    expect(aligned[0].confidence).toBeLessThan(1);
  });

  it('replie sur les timestamps API quand aucune game ne correspond', () => {
    const sets = [makeSet(1, 2, 100, 700), makeSet(2, 2, 9000, 9600)];
    const candidates = makeGames([120, 400]);

    const aligned = alignSets(sets, candidates, options());

    expect(aligned[1].source).toBe('api');
    expect(aligned[1].games).toHaveLength(0);
    // preRoll 25s appliqué au temps API converti.
    expect(aligned[1].startSeconds).toBe(9000 - DEFAULT_ALIGNER_OPTIONS.preRollSeconds);
    expect(aligned[1].endSeconds).toBe(9600 + DEFAULT_ALIGNER_OPTIONS.postRollSeconds);
  });

  it('ne cherche aucune game pour un set gagné par forfait', () => {
    const sets = [makeSet(1, 0, 100, 200), makeSet(2, 2, 400, 1000)];
    const candidates = makeGames([420, 700]);

    const aligned = alignSets(sets, candidates, options());

    expect(aligned[0].games).toHaveLength(0);
    expect(aligned[0].warnings[0]).toContain('forfait');
    expect(aligned[1].games).toHaveLength(2);
  });

  it('applique le biais estimé aux temps API', () => {
    // Les temps API sont tous en avance de 300s sur la réalité vidéo.
    const sets = [makeSet(1, 2, 100, 700)];
    const candidates = makeGames([400, 680]);

    const withoutBias = alignSets(sets, candidates, options());
    const withBias = alignSets(sets, candidates, options({ biasSeconds: 300 }));

    expect(withBias[0].confidence).toBeGreaterThan(withoutBias[0].confidence);
  });

  it('garde les sets dans l\'ordre chronologique du stream', () => {
    const sets = [
      makeSet(1, 2, 100, 700),
      makeSet(2, 2, 1000, 1600),
      makeSet(3, 2, 2000, 2600),
    ];
    const candidates = makeGames([120, 400, 1050, 1350, 2050, 2350]);

    const aligned = alignSets(sets, candidates, options());

    const starts = aligned.map((a) => a.startSeconds);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(aligned.every((a) => a.games.length === 2)).toBe(true);
  });
});

describe('estimateBias', () => {
  it('retrouve un décalage systématique des timestamps Start.gg', () => {
    const trueOffset = -240; // le TO lance ses sets 4 minutes trop tard
    const sets = [
      makeSet(1, 2, 1000, 1600),
      makeSet(2, 2, 3000, 3600),
      makeSet(3, 2, 5000, 5600),
      makeSet(4, 2, 7000, 7600),
    ];
    const candidates: GameCandidate[] = sets.map((s) => ({
      startSeconds: s.apiStartUnix! - RECORDED_AT + trueOffset,
      endSeconds: s.apiEndUnix! - RECORDED_AT + trueOffset,
      confidence: 0.9,
      snappedToBlack: true,
      ocrConfirmed: null,
    }));

    const estimate = estimateBias(candidates, sets, RECORDED_AT, 10_000);

    expect(estimate.biasSeconds).toBe(trueOffset);
    expect(estimate.confidence).toBeGreaterThan(0.5);
    expect(estimate.setsUsed).toBe(4);
  });

  it('renvoie un biais nul quand trop peu de sets ont des timestamps', () => {
    const sets = [makeSet(1, 2, 1000, 1600)];
    const estimate = estimateBias(makeGames([1000]), sets, RECORDED_AT, 10_000);

    expect(estimate.biasSeconds).toBe(0);
    expect(estimate.confidence).toBe(0);
  });
});

describe('segment', () => {
  /** Construit un signal synthétique : HUD haut pendant les games, noir aux transitions. */
  function buildSignal(games: Array<{ from: number; to: number }>, length: number) {
    const hud = new Uint8Array(length);
    const dark = new Uint8Array(length);
    for (const game of games) {
      for (let t = game.from; t < game.to; t++) hud[t] = 40; // ~0.157
      // Fondu au noir de 3s juste avant le HUD.
      for (let t = game.from - 3; t < game.from; t++) if (t >= 0) dark[t] = 250;
    }
    return { sampleRate: 1, startSeconds: 0, hud, dark };
  }

  it('extrait un intervalle par game et recale le début sur le fondu au noir', () => {
    const signal = buildSignal(
      [
        { from: 100, to: 300 },
        { from: 500, to: 750 },
      ],
      1000,
    );

    const candidates = segment(signal, DEFAULT_SEGMENTER_OPTIONS);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].startSeconds).toBe(97);
    expect(candidates[0].snappedToBlack).toBe(true);
    expect(candidates[1].startSeconds).toBe(497);
  });

  it('fusionne un kill screen court au lieu de couper la game en deux', () => {
    const signal = buildSignal(
      [
        { from: 100, to: 200 },
        { from: 205, to: 320 },
      ],
      1000,
    );

    const candidates = segment(signal, DEFAULT_SEGMENTER_OPTIONS);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].endSeconds).toBeGreaterThanOrEqual(319);
  });

  it('ne recolle pas deux games séparées par un sursaut parasite', () => {
    // Cas réel, overlay VGBootCamp sur Riptide 2026 : entre deux games, un
    // élément lumineux s'affiche six secondes dans la zone du HUD. Le trou de
    // 22 s se retrouve coupé en 6 s et 10 s, tous deux sous la tolérance de
    // fusion, et les deux games étaient recollées en une seule.
    const hud = new Uint8Array(1000);
    const dark = new Uint8Array(1000);
    for (let t = 100; t < 400; t++) hud[t] = 40;
    for (let t = 422; t < 700; t++) hud[t] = 40;
    // Le sursaut, au milieu du trou 400-422.
    for (let t = 406; t < 412; t++) hud[t] = 27;

    const candidates = segment(
      { sampleRate: 1, startSeconds: 0, hud, dark },
      DEFAULT_SEGMENTER_OPTIONS,
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0].endSeconds).toBeLessThan(candidates[1].startSeconds);
  });

  it('rejette les intervalles trop courts pour être une game', () => {
    const signal = buildSignal([{ from: 100, to: 120 }], 1000);

    expect(segment(signal, DEFAULT_SEGMENTER_OPTIONS)).toHaveLength(0);
  });
});

describe('filterSetsToVodWindow', () => {
  // VOD de 2h démarrée à RECORDED_AT.
  const DUREE = 7200;

  it('garde les sets qui tombent dans la fenêtre de la VOD', () => {
    const sets = [
      makeSet(1, 2, 600, 1200),
      makeSet(2, 2, 3000, 3600),
      makeSet(3, 2, 6000, 6600),
    ];

    const { kept, dropped } = filterSetsToVodWindow(sets, RECORDED_AT, DUREE);

    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
  });

  it('écarte les sets appartenant à une autre partie du stream', () => {
    const sets = [
      // Partie 1, terminée bien avant le début de cette VOD.
      makeSet(1, 2, -20000, -19000),
      makeSet(2, 2, 600, 1200),
      // Partie 3, largement après la fin.
      makeSet(3, 2, 30000, 31000),
    ];

    const { kept, dropped } = filterSetsToVodWindow(sets, RECORDED_AT, DUREE);

    expect(kept.map((s) => s.setStartGGId)).toEqual(['set-2']);
    expect(dropped.map((s) => s.setStartGGId)).toEqual(['set-1', 'set-3']);
  });

  it('tolère un set légèrement hors fenêtre, que le biais ramènera dedans', () => {
    // Commence 10 min avant le début de la VOD : dans la marge de 20 min.
    const sets = [makeSet(1, 2, -600, 300)];

    const { kept } = filterSetsToVodWindow(sets, RECORDED_AT, DUREE);

    expect(kept).toHaveLength(1);
  });

  it('conserve les sets sans aucun timestamp', () => {
    const sans = { ...makeSet(1, 2, 600, 1200), apiStartUnix: undefined, apiEndUnix: undefined };

    const { kept } = filterSetsToVodWindow([sans], RECORDED_AT, DUREE);

    expect(kept).toHaveLength(1);
  });

  it('ne filtre rien quand la durée de la VOD est inconnue', () => {
    const sets = [makeSet(1, 2, -20000, -19000), makeSet(2, 2, 30000, 31000)];

    const { kept, dropped } = filterSetsToVodWindow(sets, RECORDED_AT, 0);

    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });
});
