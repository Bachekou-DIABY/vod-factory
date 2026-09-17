/**
 * Extraction du nombre de games joués depuis le `displayScore` Start.gg.
 *
 * C'est la contrainte la plus forte que l'API nous donne : un set noté 3-1
 * contient exactement quatre games. Elle permet de valider un alignement vidéo
 * et de savoir qu'on a raté une game sans avoir à regarder la vidéo.
 */

export interface GameCountEstimate {
  /** Nombre exact de games si déductible, 0 pour un forfait, null sinon. */
  gameCount: number | null;
  minGames: number;
  maxGames: number;
}

/** Best-of par défaut quand Start.gg ne renseigne pas `totalGames`. */
const DEFAULT_BEST_OF = 5;

interface ParsedScore {
  a: number;
  b: number;
  forfeit: boolean;
}

/**
 * Start.gg renvoie `displayScore` sous la forme "Tag A 3 - 1 Tag B", ou "DQ",
 * ou null quand le set n'a pas été reporté. Un score négatif encode un forfait.
 */
function parseDisplayScore(displayScore?: string | null): ParsedScore | null {
  if (!displayScore) return null;

  const raw = displayScore.trim();
  if (!raw) return null;
  if (/^dq$/i.test(raw)) return { a: 0, b: 0, forfeit: true };

  // Tirets ASCII, demi-cadratin et cadratin : les overlays des TOs varient.
  const match = raw.match(/(-?\d+)\s*[-–—]\s*(-?\d+)/);
  if (!match) return null;

  const a = parseInt(match[1], 10);
  const b = parseInt(match[2], 10);
  if (!isFinite(a) || !isFinite(b)) return null;
  if (a < 0 || b < 0) return { a: 0, b: 0, forfeit: true };

  return { a, b, forfeit: false };
}

/**
 * Combine le score affiché et le best-of pour borner le nombre de games.
 *
 * @param displayScore champ `displayScore` du set Start.gg
 * @param totalGames   champ `totalGames` du set, interprété comme le best-of
 */
export function estimateGameCount(
  displayScore?: string | null,
  totalGames?: number | null,
): GameCountEstimate {
  const bestOf =
    totalGames != null && totalGames > 0 ? totalGames : DEFAULT_BEST_OF;
  const maxGames = Math.max(1, bestOf);
  const minGames = Math.max(1, Math.ceil(maxGames / 2));

  const parsed = parseDisplayScore(displayScore);

  // Score absent ou illisible : on garde les bornes du best-of.
  if (parsed === null) return { gameCount: null, minGames, maxGames };

  // Forfait : aucune game n'est passée à l'écran, il ne faut rien chercher.
  if (parsed.forfeit) return { gameCount: 0, minGames: 0, maxGames: 0 };

  const count = parsed.a + parsed.b;
  if (count <= 0) return { gameCount: null, minGames, maxGames };

  // Un score incohérent avec le best-of annoncé : on fait confiance au score,
  // qui est reporté après coup, plutôt qu'au réglage de bracket.
  return { gameCount: count, minGames: count, maxGames: count };
}
