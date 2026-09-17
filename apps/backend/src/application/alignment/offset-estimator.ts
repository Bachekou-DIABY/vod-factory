/**
 * Estimation du décalage systématique entre l'horloge Start.gg et la VOD.
 *
 * L'erreur des TOs n'est pas aléatoire : celui qui lance ses sets en retard le
 * fait sur tout le tournoi. On estime ce biais une fois, globalement, par
 * corrélation croisée entre le signal "en game" détecté dans la vidéo et le
 * signal "set en cours" reconstruit depuis l'API. Chaque set profite ensuite de
 * l'information apportée par tous les autres.
 *
 * Ce biais absorbe aussi l'erreur sur `recordedAt` quand le début de stream
 * n'est pas connu exactement.
 */

import { ExpectedSet, GameCandidate } from '../../domain/alignment/alignment.types';

export interface OffsetEstimate {
  /** Secondes à ajouter aux temps API convertis pour tomber sur la VOD. */
  biasSeconds: number;
  /** 0-1 : fraction du recouvrement possible effectivement atteinte au pic. */
  confidence: number;
  /** Nombre de sets ayant contribué à l'estimation. */
  setsUsed: number;
}

export interface OffsetEstimatorOptions {
  /** Amplitude de recherche du décalage, en secondes, de part et d'autre de 0. */
  maxLagSeconds: number;
  /** Pas de recherche, en secondes. */
  stepSeconds: number;
  /** En deçà, on ne tente pas d'estimer et on renvoie un biais nul. */
  minSetsWithTimes: number;
}

export const DEFAULT_OFFSET_OPTIONS: OffsetEstimatorOptions = {
  maxLagSeconds: 900,
  stepSeconds: 1,
  minSetsWithTimes: 3,
};

/** Trace les intervalles dans un masque booléen à la seconde. */
function paint(
  mask: Uint8Array,
  intervals: Array<{ from: number; to: number }>,
): number {
  let painted = 0;
  for (const { from, to } of intervals) {
    const start = Math.max(0, Math.floor(from));
    const end = Math.min(mask.length - 1, Math.ceil(to));
    for (let t = start; t <= end; t++) {
      if (!mask[t]) {
        mask[t] = 1;
        painted++;
      }
    }
  }
  return painted;
}

/**
 * @param recordedAtUnix début du stream en Unix seconds, tel que connu
 * @param durationSeconds durée de la VOD, borne du masque
 */
export function estimateBias(
  candidates: GameCandidate[],
  sets: ExpectedSet[],
  recordedAtUnix: number,
  durationSeconds: number,
  options: OffsetEstimatorOptions = DEFAULT_OFFSET_OPTIONS,
): OffsetEstimate {
  const n = Math.max(1, Math.floor(durationSeconds));

  const timedSets = sets.filter(
    (s) => s.apiStartUnix != null && s.apiEndUnix != null && s.gameCount !== 0,
  );

  if (
    candidates.length === 0 ||
    timedSets.length < options.minSetsWithTimes
  ) {
    return { biasSeconds: 0, confidence: 0, setsUsed: timedSets.length };
  }

  const detected = new Uint8Array(n);
  const detectedTotal = paint(
    detected,
    candidates.map((c) => ({ from: c.startSeconds, to: c.endSeconds })),
  );

  // Le masque attendu déborde de [0, n[ pour pouvoir être décalé sans perdre
  // les sets proches des bords : on l'indexe avec un offset.
  const pad = options.maxLagSeconds;
  const expected = new Uint8Array(n + 2 * pad);
  const expectedTotal = paint(
    expected,
    timedSets.map((s) => ({
      from: s.apiStartUnix! - recordedAtUnix + pad,
      to: s.apiEndUnix! - recordedAtUnix + pad,
    })),
  );

  if (detectedTotal === 0 || expectedTotal === 0) {
    return { biasSeconds: 0, confidence: 0, setsUsed: timedSets.length };
  }

  const step = Math.max(1, Math.floor(options.stepSeconds));
  let bestLag = 0;
  let bestScore = -1;
  let scoreSum = 0;
  let scoreCount = 0;

  for (let lag = -options.maxLagSeconds; lag <= options.maxLagSeconds; lag += step) {
    let score = 0;
    for (let t = 0; t < n; t++) {
      // expected décalé de `lag` : on lit à t - lag, plus le padding.
      if (detected[t] && expected[t - lag + pad]) score++;
    }
    scoreSum += score;
    scoreCount++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Confiance : part du recouvrement théoriquement atteignable qui est réalisée.
  // Un pic large et plat sur un signal peu structuré donne un score faible.
  const reachable = Math.max(1, Math.min(detectedTotal, expectedTotal));
  const coverage = bestScore / reachable;
  const meanScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
  const sharpness = bestScore > 0 ? (bestScore - meanScore) / bestScore : 0;

  const confidence = Math.max(0, Math.min(1, coverage * 0.6 + sharpness * 0.4));

  return { biasSeconds: bestLag, confidence, setsUsed: timedSets.length };
}
