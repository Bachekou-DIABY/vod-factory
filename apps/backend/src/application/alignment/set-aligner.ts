/**
 * Alignement monotone entre les sets Start.gg et les games détectées.
 *
 * Les sets d'un même stream sont séquentiels et ne se chevauchent jamais. Le
 * problème n'est donc pas "où commence ce set" mais "comment répartir une
 * séquence d'intervalles détectés sur une séquence de sets connue". C'est un
 * alignement monotone, résolu ici en programmation dynamique façon
 * Needleman-Wunsch : chaque set consomme un segment contigu de candidats, les
 * candidats non attribués sont des orphelins (warm-up, friendlies, caméra
 * plateau), et un set peut n'en consommer aucun.
 *
 * C'est ce qui permet au détecteur vidéo d'être permissif : la structure
 * élimine les faux positifs que l'ancien automate devait filtrer à coups de
 * constantes réglées à la main.
 */

import {
  AlignedSet,
  AlignmentSource,
  ExpectedSet,
  GameCandidate,
} from '../../domain/alignment/alignment.types';

export interface AlignerOptions {
  /** Décalage à appliquer aux temps API, issu de l'estimateur de biais. */
  biasSeconds: number;
  /** Début du stream en Unix seconds, pour convertir les temps API. */
  recordedAtUnix: number;
  /** Durée de la VOD, pour borner les replis sur l'API. */
  vodDurationSeconds: number;
  /** Nombre maximum de games attribuables à un set. */
  maxRunLength: number;
  /** Coût par game d'écart avec le score Start.gg. */
  weightCount: number;
  /** Coût par seconde d'écart avec `startedAt` recalé. */
  weightTime: number;
  /**
   * Coût par seconde d'écart avec `completedAt` recalé.
   * Plus faible que `weightTime` : le TO reporte le score une fois le set fini,
   * parfois plusieurs minutes après, alors qu'il marque le set en cours au
   * moment où il appelle les joueurs. `completedAt` est le champ le plus bruité.
   */
  weightTimeEnd: number;
  /** Plafond de l'écart temporel pris en compte, en secondes. */
  timeCapSeconds: number;
  /** Coût d'un candidat laissé de côté. */
  orphanPenalty: number;
  /** Coût d'un set auquel on n'attribue aucune game. */
  missingSetPenalty: number;
  /** Trou toléré entre deux games d'un même set, en secondes. */
  maxInterGameGapSeconds: number;
  /** Coût par seconde de trou au-delà de la tolérance. */
  gapPenalty: number;
  /** Marge ajoutée avant la première game du set, en secondes. */
  preRollSeconds: number;
  /** Marge ajoutée après la dernière game du set, en secondes. */
  postRollSeconds: number;
}

export const DEFAULT_ALIGNER_OPTIONS: Omit<
  AlignerOptions,
  'biasSeconds' | 'recordedAtUnix' | 'vodDurationSeconds'
> = {
  maxRunLength: 7,
  weightCount: 3,
  weightTime: 0.02,
  weightTimeEnd: 0.01,
  timeCapSeconds: 600,
  orphanPenalty: 1.5,
  // Élevé volontairement : un set passé on-stream avec un score valide est
  // presque toujours dans la vidéo. Perdre le clip coûte plus cher qu'un clip
  // dont les bornes sont approximatives.
  missingSetPenalty: 15,
  maxInterGameGapSeconds: 150,
  gapPenalty: 0.01,
  preRollSeconds: 25,
  postRollSeconds: 20,
};

/** Convertit un temps API en secondes dans la VOD, biais compris. */
function toVodSeconds(
  unixSeconds: number | undefined,
  opts: AlignerOptions,
): number | null {
  if (unixSeconds == null) return null;
  return unixSeconds - opts.recordedAtUnix + opts.biasSeconds;
}

/** Coût d'attribution des candidats [from, to) au set donné. */
function runCost(
  set: ExpectedSet,
  candidates: GameCandidate[],
  from: number,
  to: number,
  opts: AlignerOptions,
): number {
  const length = to - from;

  // Forfait : il est normal de ne rien trouver à l'écran.
  if (set.gameCount === 0) {
    return length === 0 ? 0 : opts.missingSetPenalty + length * opts.orphanPenalty;
  }

  if (length === 0) return opts.missingSetPenalty;

  let cost = 0;

  // 1. Écart au nombre de games annoncé par le score.
  if (set.gameCount !== null) {
    cost += Math.abs(length - set.gameCount) * opts.weightCount;
  } else if (length > set.maxGames) {
    cost += (length - set.maxGames) * opts.weightCount;
  } else if (length < set.minGames) {
    cost += (set.minGames - length) * opts.weightCount;
  }

  // 2. Écart aux timestamps API recalés, plafonné : un TO qui oublie de
  // reporter un set ne doit pas faire exploser le coût de tout l'alignement.
  const expectedStart = toVodSeconds(set.apiStartUnix, opts);
  if (expectedStart !== null) {
    cost +=
      Math.min(
        Math.abs(candidates[from].startSeconds - expectedStart),
        opts.timeCapSeconds,
      ) * opts.weightTime;
  }

  const expectedEnd = toVodSeconds(set.apiEndUnix, opts);
  if (expectedEnd !== null) {
    cost +=
      Math.min(
        Math.abs(candidates[to - 1].endSeconds - expectedEnd),
        opts.timeCapSeconds,
      ) * opts.weightTimeEnd;
  }

  // 3. Les games d'un même set s'enchaînent. Un trou de dix minutes entre deux
  // candidats signale qu'ils appartiennent à des sets différents.
  for (let k = from + 1; k < to; k++) {
    const gap = candidates[k].startSeconds - candidates[k - 1].endSeconds;
    if (gap > opts.maxInterGameGapSeconds) {
      cost += (gap - opts.maxInterGameGapSeconds) * opts.gapPenalty;
    }
  }

  return cost;
}

/** Marqueur de transition "ce candidat est un orphelin". */
const ORPHAN = -1;

interface Assignment {
  from: number;
  to: number;
}

/** Résout l'alignement et renvoie, pour chaque set, la plage de candidats retenue. */
function solve(
  sets: ExpectedSet[],
  candidates: GameCandidate[],
  opts: AlignerOptions,
): Assignment[] {
  const n = sets.length;
  const m = candidates.length;
  const INF = Number.POSITIVE_INFINITY;

  // dp[i][j] : coût minimal après avoir placé les sets 1..i en consommant les
  // candidats 1..j. choice[i][j] : longueur du segment pris par le set i, ou
  // ORPHAN si le candidat j a été écarté.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(INF),
  );
  const choice: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(ORPHAN),
  );

  dp[0][0] = 0;
  for (let j = 1; j <= m; j++) dp[0][j] = dp[0][j - 1] + opts.orphanPenalty;

  for (let i = 1; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      let best = INF;
      let bestRun = ORPHAN;

      const maxRun = Math.min(opts.maxRunLength, j);
      for (let r = 0; r <= maxRun; r++) {
        const previous = dp[i - 1][j - r];
        if (!isFinite(previous)) continue;
        const total = previous + runCost(sets[i - 1], candidates, j - r, j, opts);
        if (total < best) {
          best = total;
          bestRun = r;
        }
      }

      // Candidat j écarté après le set i. Calculé après la boucle car dp[i][j-1]
      // est déjà connu (j croît).
      if (j > 0 && isFinite(dp[i][j - 1])) {
        const orphaned = dp[i][j - 1] + opts.orphanPenalty;
        if (orphaned < best) {
          best = orphaned;
          bestRun = ORPHAN;
        }
      }

      dp[i][j] = best;
      choice[i][j] = bestRun;
    }
  }

  const assignments: Assignment[] = Array.from({ length: n }, () => ({
    from: 0,
    to: 0,
  }));

  let i = n;
  let j = m;
  while (i > 0) {
    const run = choice[i][j];
    if (run === ORPHAN) {
      // Le candidat j n'appartient à aucun set : on le saute.
      if (j === 0) {
        // Sécurité : ne devrait pas arriver, dp[i][0] prend toujours r = 0.
        assignments[i - 1] = { from: 0, to: 0 };
        i--;
        continue;
      }
      j--;
      continue;
    }
    assignments[i - 1] = { from: j - run, to: j };
    j -= run;
    i--;
  }

  return assignments;
}

/** Note la qualité de l'alignement d'un set, 0-1. */
function scoreConfidence(
  set: ExpectedSet,
  games: GameCandidate[],
  opts: AlignerOptions,
): number {
  if (games.length === 0) return 0;

  // Accord sur le nombre de games : le signal le plus fort dont on dispose.
  let countScore = 0.5;
  if (set.gameCount !== null && set.gameCount > 0) {
    const error = Math.abs(games.length - set.gameCount);
    countScore = Math.max(0, 1 - error / set.gameCount);
  } else if (games.length >= set.minGames && games.length <= set.maxGames) {
    countScore = 0.7;
  }

  // Accord avec les temps API recalés.
  const expectedStart = toVodSeconds(set.apiStartUnix, opts);
  let timeScore = 0.5;
  if (expectedStart !== null) {
    const error = Math.abs(games[0].startSeconds - expectedStart);
    timeScore = Math.max(0, 1 - error / opts.timeCapSeconds);
  }

  const signalScore =
    games.reduce((sum, g) => sum + g.confidence, 0) / games.length;

  const ocr = games.filter((g) => g.ocrConfirmed !== null);
  const ocrScore = ocr.length
    ? ocr.filter((g) => g.ocrConfirmed).length / ocr.length
    : null;

  const base = countScore * 0.5 + timeScore * 0.25 + signalScore * 0.25;
  // L'OCR ne sert qu'à rétrograder : il confirme, il ne crée pas de confiance.
  return Math.max(0, Math.min(1, ocrScore === null ? base : base * (0.6 + 0.4 * ocrScore)));
}

/**
 * Aligne les sets sur les candidats et produit les bornes de clip finales.
 *
 * Les sets sont supposés triés par `apiStartUnix` et les candidats par
 * `startSeconds` — c'est le cas en sortie de `getAllSetsByEventId` et de
 * `segment`.
 */
export function alignSets(
  sets: ExpectedSet[],
  candidates: GameCandidate[],
  options: AlignerOptions,
): AlignedSet[] {
  if (sets.length === 0) return [];

  const assignments =
    candidates.length > 0
      ? solve(sets, candidates, options)
      : sets.map(() => ({ from: 0, to: 0 }));

  return sets.map((set, index) => {
    const { from, to } = assignments[index];
    const games = candidates.slice(from, to);
    const warnings: string[] = [];

    let source: AlignmentSource;
    let startSeconds: number;
    let endSeconds: number;

    if (games.length === 0) {
      source = 'api';
      const apiStart = toVodSeconds(set.apiStartUnix, options);
      const apiEnd = toVodSeconds(set.apiEndUnix, options);

      if (set.gameCount === 0) {
        warnings.push('Set gagné par forfait : aucune game à découper.');
      } else {
        warnings.push(
          'Aucune game détectée dans la vidéo, repli sur les timestamps Start.gg.',
        );
      }

      startSeconds = Math.max(0, (apiStart ?? 0) - options.preRollSeconds);
      endSeconds =
        apiEnd !== null
          ? apiEnd + options.postRollSeconds
          : startSeconds + 600;
    } else {
      const expectedCount = set.gameCount;
      if (expectedCount !== null && expectedCount !== games.length) {
        source = 'video-partial';
        warnings.push(
          `Score Start.gg "${set.score ?? '?'}" annonce ${expectedCount} game(s), ${games.length} détectée(s).`,
        );
      } else {
        source = 'video';
      }

      startSeconds = Math.max(0, games[0].startSeconds - options.preRollSeconds);
      endSeconds = games[games.length - 1].endSeconds + options.postRollSeconds;
    }

    if (options.vodDurationSeconds > 0) {
      endSeconds = Math.min(endSeconds, options.vodDurationSeconds);
      startSeconds = Math.min(startSeconds, Math.max(0, endSeconds - 1));
    }

    return {
      set,
      games,
      startSeconds: Math.round(startSeconds),
      endSeconds: Math.round(endSeconds),
      source,
      confidence: scoreConfidence(set, games, options),
      warnings,
    };
  });
}
