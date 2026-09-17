/**
 * Segmentation du signal HUD en intervalles de game.
 *
 * Remplace l'automate à constantes de l'ancien détecteur OCR par un filtre
 * médian suivi d'un seuillage à hystérésis. L'hystérésis absorbe les kill
 * screens et les pauses courtes sans avoir besoin d'un compteur de frames
 * consécutives, et le recalage sur fondu au noir replace le début de game
 * avant le décompte 3-2-1.
 *
 * Fonctions pures : la segmentation peut être rejouée sur un signal déjà
 * capturé, avec des seuils plus permissifs, sans redécoder la vidéo.
 */

import { FrameSignal, GameCandidate } from '../../domain/alignment/alignment.types';

export interface SegmenterOptions {
  /** Ratio de pixels clairs dans la zone HUD pour considérer qu'on entre en game. */
  enterThreshold: number;
  /** Seuil de sortie, plus bas que `enterThreshold` (hystérésis). */
  exitThreshold: number;
  /** Largeur du filtre médian, en échantillons. Doit être impair. */
  medianWindow: number;
  /** Durée minimale d'une game retenue, en secondes. */
  minGameSeconds: number;
  /** Deux intervalles séparés par moins que cela sont fusionnés. */
  mergeGapSeconds: number;
  /** Ratio de pixels sombres à partir duquel une frame est un fondu au noir. */
  darkThreshold: number;
  /** Fenêtre de recherche du fondu au noir précédant un début de game. */
  blackLookbackSeconds: number;
  /** Fenêtre de recherche du fondu au noir suivant une fin de game. */
  blackLookaheadSeconds: number;
}

export const DEFAULT_SEGMENTER_OPTIONS: SegmenterOptions = {
  enterThreshold: 0.045,
  exitThreshold: 0.02,
  medianWindow: 5,
  minGameSeconds: 45,
  mergeGapSeconds: 12,
  darkThreshold: 0.9,
  blackLookbackSeconds: 40,
  blackLookaheadSeconds: 10,
};

/** Version relâchée, utilisée pour le re-scan des sets où il manque une game. */
export const RELAXED_SEGMENTER_OPTIONS: SegmenterOptions = {
  ...DEFAULT_SEGMENTER_OPTIONS,
  enterThreshold: 0.025,
  exitThreshold: 0.012,
  minGameSeconds: 30,
  mergeGapSeconds: 8,
};

/** Filtre médian glissant. Supprime les pics isolés sans lisser les fronts. */
export function medianFilter(values: Float32Array, window: number): Float32Array {
  const w = window % 2 === 0 ? window + 1 : window;
  if (w <= 1 || values.length === 0) return values.slice();

  const half = (w - 1) / 2;
  const out = new Float32Array(values.length);
  const buffer: number[] = [];

  for (let i = 0; i < values.length; i++) {
    buffer.length = 0;
    const from = Math.max(0, i - half);
    const to = Math.min(values.length - 1, i + half);
    for (let k = from; k <= to; k++) buffer.push(values[k]);
    buffer.sort((a, b) => a - b);
    out[i] = buffer[(buffer.length - 1) >> 1];
  }
  return out;
}

/** Déquantifie un canal 0-255 en ratios 0-1. */
function dequantize(channel: Uint8Array): Float32Array {
  const out = new Float32Array(channel.length);
  for (let i = 0; i < channel.length; i++) out[i] = channel[i] / 255;
  return out;
}

interface RawInterval {
  from: number;
  to: number;
}

/** Seuillage à hystérésis : entre au-dessus de `enter`, sort en dessous de `exit`. */
function hysteresis(values: Float32Array, enter: number, exit: number): RawInterval[] {
  const intervals: RawInterval[] = [];
  let inGame = false;
  let from = 0;

  for (let i = 0; i < values.length; i++) {
    if (!inGame && values[i] >= enter) {
      inGame = true;
      from = i;
    } else if (inGame && values[i] < exit) {
      inGame = false;
      intervals.push({ from, to: i });
    }
  }
  if (inGame) intervals.push({ from, to: values.length - 1 });

  return intervals;
}

/** Fusionne les intervalles séparés par un trou court (kill screen, pause brève). */
function mergeClose(intervals: RawInterval[], maxGap: number): RawInterval[] {
  if (intervals.length === 0) return [];

  const merged: RawInterval[] = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].from - last.to <= maxGap) {
      last.to = intervals[i].to;
    } else {
      merged.push({ ...intervals[i] });
    }
  }
  return merged;
}

/**
 * Recale un début d'intervalle sur le début du fondu au noir qui le précède.
 * Sans cela, la game commence au moment où le HUD s'allume, donc après le
 * décompte et l'intro de stage.
 */
function snapStartToBlack(
  index: number,
  dark: Float32Array,
  darkThreshold: number,
  lookback: number,
): { index: number; snapped: boolean } {
  const floor = Math.max(0, index - lookback);

  let lastDark = -1;
  for (let i = index; i >= floor; i--) {
    if (dark[i] >= darkThreshold) {
      lastDark = i;
      break;
    }
  }
  if (lastDark < 0) return { index, snapped: false };

  // Remonter au premier échantillon du fondu, pas au dernier.
  let start = lastDark;
  while (start - 1 >= floor && dark[start - 1] >= darkThreshold) start--;

  return { index: start, snapped: true };
}

/** Étend une fin d'intervalle jusqu'au fondu au noir qui la suit, s'il est proche. */
function snapEndToBlack(
  index: number,
  dark: Float32Array,
  darkThreshold: number,
  lookahead: number,
): number {
  const ceiling = Math.min(dark.length - 1, index + lookahead);
  for (let i = index; i <= ceiling; i++) {
    if (dark[i] >= darkThreshold) return i;
  }
  return index;
}

/**
 * Transforme un signal HUD en liste de games candidates.
 *
 * Volontairement permissif : les faux positifs (écran de bracket, replay,
 * caméra plateau) sont éliminés plus tard par l'alignement sur la structure
 * Start.gg, qui sait combien de games chaque set contient.
 */
export function segment(
  signal: FrameSignal,
  options: SegmenterOptions = DEFAULT_SEGMENTER_OPTIONS,
): GameCandidate[] {
  if (signal.hud.length === 0) return [];

  const rate = signal.sampleRate > 0 ? signal.sampleRate : 1;
  const toSamples = (seconds: number) => Math.max(1, Math.round(seconds * rate));
  const toSeconds = (index: number) => signal.startSeconds + index / rate;

  const hud = medianFilter(dequantize(signal.hud), options.medianWindow);
  const dark = dequantize(signal.dark);

  const raw = mergeClose(
    hysteresis(hud, options.enterThreshold, options.exitThreshold),
    toSamples(options.mergeGapSeconds),
  );

  const minSamples = toSamples(options.minGameSeconds);
  const lookback = toSamples(options.blackLookbackSeconds);
  const lookahead = toSamples(options.blackLookaheadSeconds);

  const candidates: GameCandidate[] = [];

  for (const interval of raw) {
    if (interval.to - interval.from < minSamples) continue;

    // La confiance est mesurée sur l'intervalle brut, avant recalage : les
    // frames de fondu au noir feraient chuter la moyenne artificiellement.
    let sum = 0;
    for (let i = interval.from; i <= interval.to; i++) sum += hud[i];
    const mean = sum / (interval.to - interval.from + 1);

    const snappedStart = snapStartToBlack(
      interval.from,
      dark,
      options.darkThreshold,
      lookback,
    );
    const snappedEnd = snapEndToBlack(
      interval.to,
      dark,
      options.darkThreshold,
      lookahead,
    );

    candidates.push({
      startSeconds: Math.round(toSeconds(snappedStart.index)),
      endSeconds: Math.round(toSeconds(snappedEnd)),
      // Normalisation sur le seuil d'entrée : à peine au-dessus du seuil → ~0.5.
      confidence: Math.max(0, Math.min(1, mean / (options.enterThreshold * 2))),
      snappedToBlack: snappedStart.snapped,
      ocrConfirmed: null,
    });
  }

  // Le recalage sur fondu peut faire empiéter un candidat sur le précédent.
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].startSeconds < candidates[i - 1].endSeconds) {
      candidates[i].startSeconds = candidates[i - 1].endSeconds;
    }
  }

  return candidates.filter((c) => c.endSeconds > c.startSeconds);
}

/**
 * Re-segmente une fenêtre du signal avec des seuils relâchés.
 *
 * Appelé quand l'alignement trouve moins de games que le score Start.gg n'en
 * annonce : la game manquante est presque toujours sous le seuil, pas hors
 * de l'échantillonnage. Aucun redécodage n'est nécessaire.
 */
export function resegmentWindow(
  signal: FrameSignal,
  fromSeconds: number,
  toSeconds: number,
  options: SegmenterOptions = RELAXED_SEGMENTER_OPTIONS,
): GameCandidate[] {
  const rate = signal.sampleRate > 0 ? signal.sampleRate : 1;
  const fromIndex = Math.max(
    0,
    Math.floor((fromSeconds - signal.startSeconds) * rate),
  );
  const toIndex = Math.min(
    signal.hud.length,
    Math.ceil((toSeconds - signal.startSeconds) * rate),
  );
  if (toIndex <= fromIndex) return [];

  const window: FrameSignal = {
    sampleRate: rate,
    startSeconds: signal.startSeconds + fromIndex / rate,
    hud: signal.hud.subarray(fromIndex, toIndex),
    dark: signal.dark.subarray(fromIndex, toIndex),
  };

  return segment(window, options);
}
