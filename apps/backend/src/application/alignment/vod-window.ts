/**
 * Restriction des sets attendus à la fenêtre temporelle réellement couverte
 * par la VOD.
 *
 * Un stream de tournoi est souvent découpé en plusieurs VODs : le TO coupe
 * pour la pause déjeuner, ou Twitch segmente automatiquement. Chaque partie
 * devient une VOD distincte avec son propre `recordedAt`, mais Start.gg renvoie
 * toujours l'intégralité des sets du stream.
 *
 * Sans filtrage, aligner la partie 2 revient à chercher les sets de la partie 1
 * dans une vidéo qui ne les contient pas. L'alignement ne les trouve pas, les
 * marque en repli `api`, et le rapport devient illisible alors que rien n'est
 * réellement cassé.
 *
 * La marge est volontairement large : le biais entre l'horloge Start.gg et la
 * VOD n'est pas encore connu à ce stade, puisqu'il s'estime après la détection.
 * Elle doit donc couvrir au moins l'amplitude de recherche de ce biais.
 */

import { ExpectedSet } from '../../domain/alignment/alignment.types';

/**
 * Marge appliquée de part et d'autre de la fenêtre de la VOD, en secondes.
 * Supérieure au `maxLagSeconds` de l'estimateur de biais, pour ne jamais
 * écarter un set que le recalage aurait ramené dans la fenêtre.
 */
export const DEFAULT_VOD_WINDOW_SLACK_SECONDS = 1200;

export interface VodWindowFilterResult {
  kept: ExpectedSet[];
  /** Sets écartés parce qu'ils tombent hors de la fenêtre, marge comprise. */
  dropped: ExpectedSet[];
}

/**
 * Garde les sets dont l'intervalle Start.gg recoupe la fenêtre de la VOD.
 *
 * Un set dont les deux timestamps sont absents est conservé : on ne peut pas
 * le situer, et c'est à l'alignement de trancher. Un set qui n'a qu'une borne
 * est traité sur cette seule borne.
 *
 * @param recordedAtUnix  début du stream, en secondes Unix
 * @param durationSeconds durée de la VOD ; 0 ou négatif désactive le filtrage
 */
export function filterSetsToVodWindow(
  sets: ExpectedSet[],
  recordedAtUnix: number,
  durationSeconds: number,
  slackSeconds: number = DEFAULT_VOD_WINDOW_SLACK_SECONDS,
): VodWindowFilterResult {
  // Sans durée fiable, on ne sait pas où s'arrête la VOD : ne rien écarter.
  if (!(durationSeconds > 0)) {
    return { kept: [...sets], dropped: [] };
  }

  const windowStart = recordedAtUnix - slackSeconds;
  const windowEnd = recordedAtUnix + durationSeconds + slackSeconds;

  const kept: ExpectedSet[] = [];
  const dropped: ExpectedSet[] = [];

  for (const set of sets) {
    const start = set.apiStartUnix ?? set.apiEndUnix;
    const end = set.apiEndUnix ?? set.apiStartUnix;

    // Aucune borne exploitable : on laisse l'alignement décider.
    if (start == null || end == null) {
      kept.push(set);
      continue;
    }

    const overlaps = end >= windowStart && start <= windowEnd;
    (overlaps ? kept : dropped).push(set);
  }

  return { kept, dropped };
}
