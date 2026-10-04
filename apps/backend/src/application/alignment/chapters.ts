/**
 * Chapitres YouTube d'un clip : une ligne par game, à coller dans la
 * description.
 *
 * YouTube n'en fait des chapitres cliquables que si la liste commence à 0:00,
 * compte au moins trois entrées et que chacune dure au moins dix secondes.
 * Une liste qui ne respecte pas ces règles s'afficherait comme du simple
 * texte : on ne la produit pas du tout.
 */

const CHAPITRES_MIN = 3;
const DUREE_MIN_SECONDS = 10;

/**
 * Tolérance avant le début du clip : une game qui démarre quelques secondes
 * avant la borne, à cause d'un arrondi de recoupe, reste la première game.
 */
const TOLERANCE_DEBUT_SECONDS = 5;

interface Intervalle {
  startSeconds: number;
  endSeconds: number;
}

function horodatage(secondes: number, avecHeures: boolean): string {
  const s = Math.max(0, Math.floor(secondes));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return avecHeures
    ? `${h}:${String(m).padStart(2, '0')}:${sec}`
    : `${m}:${sec}`;
}

/**
 * Renvoie les lignes de chapitres, ou `null` si YouTube ne les accepterait pas.
 *
 * Les games sont en secondes dans la VOD ; le clip aussi. Seules comptent
 * celles qui démarrent dans le clip : après une recoupe, une game écartée
 * (écran de configuration, bout de jeu voisin) disparaît d'elle-même.
 */
export function chapitresYoutube(
  clip: Intervalle,
  games: Intervalle[],
): string | null {
  const duree = clip.endSeconds - clip.startSeconds;
  if (duree <= 0) return null;

  const debuts = games
    .filter(
      (g) =>
        g.startSeconds >= clip.startSeconds - TOLERANCE_DEBUT_SECONDS &&
        g.startSeconds < clip.endSeconds,
    )
    .map((g) => Math.max(0, g.startSeconds - clip.startSeconds))
    .sort((a, b) => a - b);

  if (debuts.length < CHAPITRES_MIN) return null;

  // Le premier chapitre doit être à 0:00 : il couvre aussi le pré-roll.
  debuts[0] = 0;

  for (let i = 0; i < debuts.length; i++) {
    const fin = i + 1 < debuts.length ? debuts[i + 1] : duree;
    if (fin - debuts[i] < DUREE_MIN_SECONDS) return null;
  }

  const avecHeures = duree >= 3600;
  return debuts
    .map((d, i) => `${horodatage(d, avecHeures)} Game ${i + 1}`)
    .join('\n');
}
