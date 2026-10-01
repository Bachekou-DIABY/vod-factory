import { ExpectedSet } from '../../domain/alignment/alignment.types';

/**
 * Écart sous lequel début et fin Start.gg sont tenus pour identiques.
 *
 * Aucun set ne dure moins d'une minute : un tel écart signifie que le TO n'a
 * pas lancé le set dans Start.gg et a saisi le score d'un bloc, après coup.
 */
const SAISIE_APRES_COUP_SECONDS = 60;

/**
 * Vrai quand Start.gg ne connaît du set que l'heure où son score a été saisi.
 *
 * Cette heure n'est pas un début : le set s'est joué avant, parfois longtemps
 * avant. Sur La Suite #9, un score saisi dix minutes après la fin du set
 * tombait après la fin de la VOD, et l'aligneur cherchait le set au mauvais
 * endroit. Voir `la-suite-regression.spec.ts`.
 */
export function scoreSaisiApresCoup(set: ExpectedSet): boolean {
  return (
    set.apiStartUnix != null &&
    set.apiEndUnix != null &&
    set.apiEndUnix - set.apiStartUnix < SAISIE_APRES_COUP_SECONDS
  );
}

/**
 * Délai toléré entre la fin réelle d'un set et la saisie de son score.
 *
 * Dix minutes observées sur La Suite #9 ; au-delà, l'écart redevient coûteux,
 * sans quoi rien n'empêcherait le set de dériver vers des games bien plus
 * anciennes.
 */
export const DELAI_SAISIE_MAX_SECONDS = 1200;
