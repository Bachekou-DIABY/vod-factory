/**
 * Types du pipeline d'alignement set ↔ vidéo.
 *
 * Principe : Start.gg fournit la STRUCTURE (liste ordonnée des sets, nombre de
 * games par set via displayScore) et des timestamps bruités. La vidéo fournit
 * des FRONTIÈRES précises mais bruitées elles aussi. L'alignement monotone
 * combine les deux : la structure élimine les faux positifs vidéo, la vidéo
 * corrige l'imprécision des timestamps.
 */

/** Intervalle de game détecté dans la vidéo, en secondes depuis le début de la VOD. */
export interface GameCandidate {
  startSeconds: number;
  endSeconds: number;
  /** Force moyenne du signal HUD sur l'intervalle, 0-1. */
  confidence: number;
  /** true si le début a été recalé sur un fondu au noir. */
  snappedToBlack: boolean;
  /** Résultat de la validation OCR du timer. null si l'OCR n'a pas tourné. */
  ocrConfirmed: boolean | null;
}

/** Un set attendu, tel que décrit par Start.gg. */
export interface ExpectedSet {
  setStartGGId: string;
  roundName: string;
  phaseName?: string;
  players: string;
  score?: string;
  /** Unix seconds rapportés par le TO. Bruités : lancement/report manuels. */
  apiStartUnix?: number;
  apiEndUnix?: number;
  /** Nombre de games déduit du displayScore. null si illisible, 0 si DQ. */
  gameCount: number | null;
  /** Bornes déduites du best-of quand gameCount est inconnu. */
  minGames: number;
  maxGames: number;
}

export type AlignmentSource =
  /** Frontières vidéo, nombre de games conforme au score Start.gg. */
  | 'video'
  /** Frontières vidéo, mais nombre de games différent du score annoncé. */
  | 'video-partial'
  /** Aucun candidat vidéo retenu : repli sur les timestamps API recalés. */
  | 'api';

export interface AlignedSet {
  set: ExpectedSet;
  /** Candidats retenus pour ce set, dans l'ordre chronologique. */
  games: GameCandidate[];
  /** Bornes finales du clip, pré/post-roll inclus, en secondes dans la VOD. */
  startSeconds: number;
  endSeconds: number;
  source: AlignmentSource;
  /** 0-1 : accord entre le nombre de games attendu, les temps API et le signal. */
  confidence: number;
  warnings: string[];
}

export interface AlignmentReport {
  vodId: string;
  /** Décalage estimé entre l'horloge Start.gg et l'horloge VOD, en secondes. */
  biasSeconds: number;
  /** 0-1 : netteté du pic de corrélation ayant produit le biais. */
  biasConfidence: number;
  candidatesDetected: number;
  setsTotal: number;
  setsFromVideo: number;
  setsPartial: number;
  setsFromApiOnly: number;
  aligned: AlignedSet[];
  generatedAt: string;
}

/** Signal temporel bas coût extrait de la VOD, un échantillon par seconde. */
export interface FrameSignal {
  /** Échantillons par seconde. */
  sampleRate: number;
  /** Offset du premier échantillon dans la VOD, en secondes. */
  startSeconds: number;
  /** Ratio de pixels clairs dans la zone HUD, quantifié 0-255. */
  hud: Uint8Array;
  /** Ratio de pixels sombres sur toute la frame, quantifié 0-255. */
  dark: Uint8Array;
}
