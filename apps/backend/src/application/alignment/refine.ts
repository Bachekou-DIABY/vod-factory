/**
 * Raffinement de l'alignement : les passes de rattrapage qui suivent le premier
 * alignement, jusqu'aux bornes de clip definitives.
 *
 * Ces etapes vivaient en methodes privees du cas d'usage, donc hors de portee
 * des tests. C'est ce qui a laisse passer une regression sur Riptide : le banc
 * d'essai ne pouvait reproduire que la segmentation et l'alignement, pas la
 * chaine reelle. Les sortir ici rend le pipeline entier verifiable sur une
 * fixture, sans base de donnees ni fichier video.
 */

import {
  AlignedSet,
  ExpectedSet,
  FrameSignal,
  GameCandidate,
} from '../../domain/alignment/alignment.types';
import { AlignerOptions, alignSets } from './set-aligner';
import { RELAXED_SEGMENTER_OPTIONS, resegmentWindow } from './segmenter';
import { splitToMatchCount } from './game-splitter';
import {
  DEFAULT_CLIP_BOUNDS_OPTIONS,
  clampToNextClip,
  trimDeadPreRoll,
} from './clip-bounds';

/** Marge ajoutee de part et d'autre d'un set lors du re-scan relache. */
export const REFINE_WINDOW_PADDING_SECONDS = 120;

/** Recouvrement au-dela duquel deux candidats designent la meme game. */
export const DUPLICATE_OVERLAP_RATIO = 0.5;

export interface RefineResult {
  aligned: AlignedSet[];
  candidates: GameCandidate[];
  /** Games recuperees par le re-scan relache. */
  recuperees: number;
  /** Games recollees separees d'apres le score. */
  decoupees: number;
  /** Debuts de clip recales pour ne pas ouvrir sur une image morte. */
  recales: number;
}

function overlapsAny(candidate: GameCandidate, known: GameCandidate[]): boolean {
  const length = Math.max(1, candidate.endSeconds - candidate.startSeconds);
  return known.some((other) => {
    const overlap =
      Math.min(candidate.endSeconds, other.endSeconds) -
      Math.max(candidate.startSeconds, other.startSeconds);
    return overlap / length > DUPLICATE_OVERLAP_RATIO;
  });
}

/**
 * Re-segmente a seuils relaches les fenetres des sets ou il manque des games.
 * Le signal est deja en memoire, donc cette passe ne coute aucun decodage.
 */
export function collectMissingGames(
  signal: FrameSignal,
  aligned: AlignedSet[],
): GameCandidate[] {
  const extra: GameCandidate[] = [];

  for (const entry of aligned) {
    const expected = entry.set.gameCount;
    if (expected === null || expected === 0) continue;
    if (entry.games.length >= expected) continue;

    const relaxed = resegmentWindow(
      signal,
      entry.startSeconds - REFINE_WINDOW_PADDING_SECONDS,
      entry.endSeconds + REFINE_WINDOW_PADDING_SECONDS,
      RELAXED_SEGMENTER_OPTIONS,
    );
    for (const candidate of relaxed) {
      if (!overlapsAny(candidate, entry.games)) extra.push(candidate);
    }
  }

  return extra;
}

export function mergeCandidates(
  base: GameCandidate[],
  extra: GameCandidate[],
): GameCandidate[] {
  const merged = [...base];
  for (const candidate of extra) {
    if (!overlapsAny(candidate, merged)) merged.push(candidate);
  }
  return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}

/**
 * Decoupe les games recollees des sets encore incomplets. Mute `aligned` et
 * renvoie le nombre de coupes realisees.
 */
export function splitMergedGames(
  signal: FrameSignal,
  aligned: AlignedSet[],
): number {
  let coupes = 0;

  for (const entry of aligned) {
    const attendu = entry.set.gameCount;
    if (attendu === null || attendu === 0) continue;
    if (entry.games.length >= attendu) continue;

    const avant = entry.games.length;
    entry.games = splitToMatchCount(entry.games, signal, attendu);
    coupes += entry.games.length - avant;
  }

  return coupes;
}

/**
 * Reconstruit la liste globale de candidats a partir des games reparties, en
 * conservant les orphelins que l'alignement n'avait attribues a personne.
 */
export function rebuildCandidates(
  aligned: AlignedSet[],
  precedents: GameCandidate[],
): GameCandidate[] {
  const attribues = aligned.flatMap((a) => a.games);
  const orphelins = precedents.filter((c) => !overlapsAny(c, attribues));
  return [...attribues, ...orphelins].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );
}

/**
 * Chaine complete : alignement, rattrapages, puis bornes de clip.
 *
 * C'est exactement ce que le cas d'usage executait en ligne, a la persistance
 * et aux journaux pres.
 */
export function refineAlignment(
  signal: FrameSignal,
  sets: ExpectedSet[],
  candidatsInitiaux: GameCandidate[],
  options: AlignerOptions,
): RefineResult {
  let candidates = candidatsInitiaux;
  let aligned = alignSets(sets, candidates, options);

  const extra = collectMissingGames(signal, aligned);
  if (extra.length > 0) {
    candidates = mergeCandidates(candidates, extra);
    aligned = alignSets(sets, candidates, options);
  }

  const decoupees = splitMergedGames(signal, aligned);
  if (decoupees > 0) {
    candidates = rebuildCandidates(aligned, candidates);
    aligned = alignSets(sets, candidates, options);
  }

  const avant = aligned;
  aligned = trimDeadPreRoll(signal, aligned, {
    ...DEFAULT_CLIP_BOUNDS_OPTIONS,
    preRollSeconds: options.preRollSeconds,
  });
  aligned = clampToNextClip(aligned);
  const recales = aligned.filter(
    (a, i) => a.startSeconds !== avant[i].startSeconds,
  ).length;

  return { aligned, candidates, recuperees: extra.length, decoupees, recales };
}
