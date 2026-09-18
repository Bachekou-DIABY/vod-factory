/**
 * Découpe d'une game candidate quand le score Start.gg en annonce davantage.
 *
 * Le motif observé sur les trois tournois testés est constant : quand le
 * compte ne tombe pas, il manque toujours une game, jamais l'inverse. Deux
 * games consécutives ont été recollées parce que la transition qui les sépare
 * n'a pas franchi les seuils, typiquement sur un habillage dont le cadre reste
 * allumé pendant le fondu.
 *
 * La question utile n'est donc pas « où est la game manquante » mais « laquelle
 * de celles que j'ai est en réalité deux ». Le score dit combien de coupes il
 * faut, et le canal de noirceur dit où les placer. C'est le même principe que
 * l'alignement : la structure Start.gg contraint une détection permissive.
 */

import { FrameSignal, GameCandidate } from '../../domain/alignment/alignment.types';

export interface SplitterOptions {
  /** Durée minimale de chaque moitié après découpe, en secondes. */
  minHalfSeconds: number;
  /**
   * Noirceur minimale du creux retenu, en multiple de la noirceur médiane de
   * l'intervalle. Un critère relatif, car la profondeur des fondus dépend
   * entièrement de l'habillage.
   */
  darknessRatio: number;
  /** Plancher absolu, pour ne pas couper sur un frémissement. */
  darknessFloor: number;
}

export const DEFAULT_SPLITTER_OPTIONS: SplitterOptions = {
  minHalfSeconds: 40,
  darknessRatio: 2.5,
  darknessFloor: 0.12,
};

/** Médiane d'une tranche, sans trier tout le signal. */
function median(values: Float32Array, from: number, to: number): number {
  const tranche = Array.from(values.slice(from, to)).sort((a, b) => a - b);
  return tranche.length ? tranche[tranche.length >> 1] : 0;
}

/**
 * Cherche le meilleur endroit où couper un intervalle : le creux de noirceur le
 * plus marqué, suffisamment loin des deux bords pour laisser deux vraies games.
 *
 * Renvoie la seconde de coupe, ou `null` si aucun creux ne se détache assez du
 * fond pour qu'on puisse raisonnablement parler d'une transition.
 */
export function findSplitSecond(
  signal: FrameSignal,
  startSeconds: number,
  endSeconds: number,
  options: SplitterOptions = DEFAULT_SPLITTER_OPTIONS,
): number | null {
  const rate = signal.sampleRate > 0 ? signal.sampleRate : 1;
  const toIndex = (s: number) => Math.round((s - signal.startSeconds) * rate);

  const debut = Math.max(0, toIndex(startSeconds));
  const fin = Math.min(signal.dark.length, toIndex(endSeconds));
  const marge = Math.max(1, Math.round(options.minHalfSeconds * rate));

  if (fin - debut < marge * 2) return null;

  const dark = new Float32Array(fin - debut);
  for (let i = 0; i < dark.length; i++) dark[i] = signal.dark[debut + i] / 255;

  const fond = median(dark, 0, dark.length);
  const seuil = Math.max(options.darknessFloor, fond * options.darknessRatio);

  let meilleur = -1;
  let meilleureNoirceur = 0;
  for (let i = marge; i < dark.length - marge; i++) {
    if (dark[i] > meilleureNoirceur) {
      meilleureNoirceur = dark[i];
      meilleur = i;
    }
  }

  if (meilleur < 0 || meilleureNoirceur < seuil) return null;

  return Math.round(signal.startSeconds + (debut + meilleur) / rate);
}

/**
 * Découpe les games d'un set jusqu'à atteindre le nombre annoncé par le score.
 *
 * À chaque passe, la plus longue game est coupée à son creux le plus marqué.
 * S'arrête dès qu'aucune coupe crédible n'est trouvée, plutôt que de forcer :
 * mieux vaut rendre un set à quatre games sur cinq annoncées, signalé comme
 * partiel, qu'une cinquième game inventée au milieu de nulle part.
 */
export function splitToMatchCount(
  games: GameCandidate[],
  signal: FrameSignal,
  cible: number,
  options: SplitterOptions = DEFAULT_SPLITTER_OPTIONS,
): GameCandidate[] {
  if (games.length === 0 || games.length >= cible) return games;

  let resultat = [...games];

  while (resultat.length < cible) {
    let indexPlusLongue = -1;
    let dureeMax = 0;
    for (let i = 0; i < resultat.length; i++) {
      const duree = resultat[i].endSeconds - resultat[i].startSeconds;
      if (duree > dureeMax) {
        dureeMax = duree;
        indexPlusLongue = i;
      }
    }
    if (indexPlusLongue < 0) break;

    const game = resultat[indexPlusLongue];
    const coupe = findSplitSecond(signal, game.startSeconds, game.endSeconds, options);
    if (coupe === null) break;

    // La confiance des deux moitiés est rabaissée : elles viennent d'une
    // déduction depuis le score, pas d'une détection franche.
    const moitie = (startSeconds: number, endSeconds: number): GameCandidate => ({
      startSeconds,
      endSeconds,
      confidence: game.confidence * 0.8,
      snappedToBlack: true,
      ocrConfirmed: game.ocrConfirmed,
    });

    resultat.splice(
      indexPlusLongue,
      1,
      moitie(game.startSeconds, coupe),
      moitie(coupe, game.endSeconds),
    );
  }

  return resultat.sort((a, b) => a.startSeconds - b.startSeconds);
}
