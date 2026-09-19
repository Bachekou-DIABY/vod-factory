/**
 * Affinage du début de clip d'après le contenu réel de l'image.
 *
 * L'aligneur recule d'une marge fixe avant la première game. Sur une VOD de
 * tournoi, cette marge tombe très souvent dans l'intermission entre deux sets,
 * où le stream affiche un écran d'attente sombre pendant plusieurs minutes.
 * Onze clips sur vingt-et-un de L'Oracle ouvraient ainsi sur vingt-cinq
 * secondes d'image morte.
 *
 * Aucune valeur fixe ne peut corriger ça, puisque le bon recul dépend de ce
 * qui se trouve à cet endroit : parfois un character select qu'il faut garder,
 * parfois un écran d'attente qu'il faut sauter. On regarde donc le signal.
 *
 * Le critère est relatif à la noirceur observée pendant le jeu, jamais absolu :
 * la noirceur d'un habillage n'a aucune valeur universelle.
 */

import { AlignedSet, FrameSignal } from '../../domain/alignment/alignment.types';

export interface ClipBoundsOptions {
  /** Recul maximal avant la première game, en secondes. */
  preRollSeconds: number;
  /**
   * Durée en deçà de laquelle un bloc mort collé à la game est lu comme le
   * fondu d'entrée normal, et non comme une intermission. Au-delà, c'est que
   * le set est précédé d'un écran d'attente et le recul est ramené au minimum.
   */
  fadeAllowanceSeconds: number;
  /** Durée minimale d'un bloc mort pour qu'il compte, en secondes. */
  minDeadRunSeconds: number;
  /** Noirceur d'une image morte, en multiple de la noirceur médiane en jeu. */
  deadDarknessRatio: number;
  /** Plancher absolu, pour une VOD dont le jeu serait déjà très sombre. */
  deadDarknessFloor: number;
}

export const DEFAULT_CLIP_BOUNDS_OPTIONS: ClipBoundsOptions = {
  preRollSeconds: 25,
  fadeAllowanceSeconds: 10,
  minDeadRunSeconds: 4,
  deadDarknessRatio: 4,
  deadDarknessFloor: 0.12,
};

/**
 * Noirceur médiane pendant les games alignées, qui sert de référence.
 *
 * Prise sur le jeu et non sur toute la VOD : sur L'Oracle, plus de la moitié
 * du signal est de l'intermission, et la médiane globale (0,251) est quatre
 * fois celle mesurée en jeu (0,059). Calibrer dessus ne détecterait plus rien.
 */
export function inGameDarkness(signal: FrameSignal, aligned: AlignedSet[]): number {
  const rate = signal.sampleRate > 0 ? signal.sampleRate : 1;
  const toIndex = (s: number) => Math.round((s - signal.startSeconds) * rate);

  const valeurs: number[] = [];
  for (const set of aligned) {
    for (const game of set.games) {
      const from = Math.max(0, toIndex(game.startSeconds));
      const to = Math.min(signal.dark.length, toIndex(game.endSeconds));
      for (let i = from; i < to; i++) valeurs.push(signal.dark[i]);
    }
  }
  if (valeurs.length === 0) return 0;
  valeurs.sort((a, b) => a - b);
  return valeurs[valeurs.length >> 1] / 255;
}

/** Bloc contigu de secondes mortes, exprimé en secondes avant la game. */
interface DeadRun {
  /** Début du bloc, au plus proche de la game. */
  from: number;
  /** Fin du bloc, au plus loin de la game. */
  to: number;
}

function deadRuns(dead: boolean[]): DeadRun[] {
  const runs: DeadRun[] = [];
  let k = 0;
  while (k < dead.length) {
    if (!dead[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < dead.length && dead[j]) j++;
    runs.push({ from: k + 1, to: j });
    k = j;
  }
  return runs;
}

/**
 * Recul à appliquer avant `gameStartSeconds`, en secondes.
 *
 * Le clip doit ouvrir sur de l'image vivante et ne contenir aucun bloc mort
 * avant la première game. Le fondu qui précède immédiatement chaque game est
 * normal et ne compte pas : sans cette exception, un fondu d'entrée un peu long
 * ferait jeter tout le character select qui le précède.
 */
export function preRollBefore(
  signal: FrameSignal,
  gameStartSeconds: number,
  threshold: number,
  options: ClipBoundsOptions = DEFAULT_CLIP_BOUNDS_OPTIONS,
): number {
  const rate = signal.sampleRate > 0 ? signal.sampleRate : 1;
  const start = Math.round((gameStartSeconds - signal.startSeconds) * rate);

  const dead: boolean[] = [];
  for (let k = 1; k <= options.preRollSeconds; k++) {
    const i = start - Math.round(k * rate);
    if (i < 0) break;
    dead.push(signal.dark[i] / 255 > threshold);
  }
  if (dead.length === 0) return 0;

  const runs = deadRuns(dead);
  const adjacent = runs.find((r) => r.from === 1);

  // Collé à la game et trop long pour un fondu : le set est précédé d'un écran
  // d'attente. Inutile de remonter dedans, on garde un lead-in minimal.
  if (adjacent && adjacent.to >= options.fadeAllowanceSeconds) {
    return Math.min(options.preRollSeconds, options.fadeAllowanceSeconds);
  }

  const bloquants = runs.filter(
    (r) => r !== adjacent && r.to - r.from + 1 >= options.minDeadRunSeconds,
  );
  if (bloquants.length === 0) return dead.length;

  // Le plus proche de la game : le clip démarre juste après lui.
  return Math.min(...bloquants.map((r) => r.from - 1));
}

/**
 * Recale le début de chaque clip pour qu'il n'ouvre pas sur de l'image morte.
 *
 * Ne touche ni aux games, ni à la fin du clip, ni aux sets repliés sur les
 * horodatages API, faute de signal exploitable pour ceux-là.
 */
export function trimDeadPreRoll(
  signal: FrameSignal,
  aligned: AlignedSet[],
  options: ClipBoundsOptions = DEFAULT_CLIP_BOUNDS_OPTIONS,
): AlignedSet[] {
  const reference = inGameDarkness(signal, aligned);
  if (reference <= 0) return aligned;

  const threshold = Math.max(
    options.deadDarknessFloor,
    reference * options.deadDarknessRatio,
  );

  return aligned.map((set) => {
    if (set.games.length === 0) return set;
    const premiere = set.games[0].startSeconds;
    const recul = preRollBefore(signal, premiere, threshold, options);
    const startSeconds = Math.max(0, premiere - recul);
    return startSeconds === set.startSeconds ? set : { ...set, startSeconds };
  });
}

/**
 * Empêche un clip de déborder sur le suivant.
 *
 * Le post-roll est une constante. Quand deux sets s'enchaînent sans pause,
 * comme une Grande Finale et son reset lancé quatre secondes plus tard, ces
 * vingt secondes mordent sur le début du set suivant et les deux clips se
 * recouvrent.
 *
 * Rien n'est perdu en raccourcissant : le clip suivant commence avec son propre
 * pré-roll, donc la transition s'y trouve déjà. On ne coupe pas du contenu, on
 * décide à qui il appartient. La borne ne descend jamais sous la fin de la
 * dernière game, pour qu'aucune game ne soit tronquée.
 */
export function clampToNextClip(aligned: AlignedSet[]): AlignedSet[] {
  const resultat = [...aligned];

  for (let i = 0; i < resultat.length - 1; i++) {
    const courant = resultat[i];
    const suivant = resultat[i + 1];
    if (courant.games.length === 0 || suivant.games.length === 0) continue;
    if (courant.endSeconds <= suivant.startSeconds) continue;

    const finDerniereGame = courant.games[courant.games.length - 1].endSeconds;
    const borne = Math.max(finDerniereGame, suivant.startSeconds);
    if (borne >= courant.endSeconds) continue;

    resultat[i] = { ...courant, endSeconds: borne };
  }

  return resultat;
}
