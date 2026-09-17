import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import Jimp from 'jimp';
import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import { GameCandidate } from '../../domain/alignment/alignment.types';
import { FrameSignalService, DEFAULT_HUD_ZONE, HudZone } from './frame-signal.service';

/**
 * Validation OCR des games candidates.
 *
 * L'OCR ne sert plus à détecter : il sert à confirmer. On échantillonne
 * quelques frames à l'intérieur de chaque intervalle déjà trouvé et on vérifie
 * que le timer SSBU s'y lit bien au format M:SS. Quelques centaines d'appels
 * Tesseract au lieu d'un par seconde de VOD, et un faux positif (écran de
 * bracket, replay) est rétrogradé au lieu de polluer l'alignement.
 */

/** Nombre de frames sondées par game candidate. */
const SAMPLES_PER_CANDIDATE = 3;
/** Une game est confirmée dès qu'une frame lit un timer valide. */
const MIN_CONFIRMED_SAMPLES = 1;

@Injectable()
export class TimerOcrValidatorService {
  private readonly logger = new Logger(TimerOcrValidatorService.name);

  private readonly cachePath = path.join(process.cwd(), '.tesseract-cache');

  constructor(private readonly frameSignal: FrameSignalService) {}

  /**
   * Renseigne `ocrConfirmed` sur chaque candidat. Les candidats sont mutés en
   * place et renvoyés. En cas d'échec de Tesseract, `ocrConfirmed` reste null
   * et l'alignement se comporte comme si l'OCR n'avait pas tourné.
   */
  async validate(
    videoPath: string,
    candidates: GameCandidate[],
    hudZone: HudZone = DEFAULT_HUD_ZONE,
  ): Promise<GameCandidate[]> {
    if (candidates.length === 0) return candidates;

    fs.mkdirSync(this.cachePath, { recursive: true });

    let worker: TesseractWorker;
    try {
      worker = await createWorker('eng', 1, {
        cachePath: this.cachePath,
        logger: () => {
          /* silence */
        },
      });
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789:',
        tessedit_pageseg_mode: '7' as never,
      });
    } catch (err) {
      this.logger.warn(
        `OCR indisponible, validation ignorée: ${(err as Error).message}`,
      );
      return candidates;
    }

    this.logger.log(`🔤 Validation OCR de ${candidates.length} games candidates`);

    try {
      for (const candidate of candidates) {
        candidate.ocrConfirmed = await this.validateCandidate(
          videoPath,
          candidate,
          hudZone,
          worker,
        );
      }
    } finally {
      await worker.terminate().catch(() => {
        /* ignore */
      });
    }

    const confirmed = candidates.filter((c) => c.ocrConfirmed === true).length;
    this.logger.log(
      `🔤 ${confirmed}/${candidates.length} games confirmées par OCR`,
    );

    return candidates;
  }

  private async validateCandidate(
    videoPath: string,
    candidate: GameCandidate,
    hudZone: HudZone,
    worker: TesseractWorker,
  ): Promise<boolean | null> {
    const timestamps = this.sampleTimestamps(candidate);
    if (timestamps.length === 0) return null;

    const frames = await this.frameSignal.extractFramesAt(videoPath, timestamps);
    if (frames.length === 0) return null;

    let confirmed = 0;
    try {
      for (const frame of frames) {
        if (await this.readsTimer(frame.filePath, hudZone, worker)) confirmed++;
        if (confirmed >= MIN_CONFIRMED_SAMPLES) break;
      }
    } finally {
      this.frameSignal.cleanupDir(frames[0].filePath);
    }

    return confirmed >= MIN_CONFIRMED_SAMPLES;
  }

  /** Répartit les sondes à l'intérieur de l'intervalle, en évitant les bords. */
  private sampleTimestamps(candidate: GameCandidate): number[] {
    const duration = candidate.endSeconds - candidate.startSeconds;
    if (duration <= 0) return [];

    const timestamps: number[] = [];
    for (let i = 1; i <= SAMPLES_PER_CANDIDATE; i++) {
      const ratio = i / (SAMPLES_PER_CANDIDATE + 1);
      timestamps.push(candidate.startSeconds + duration * ratio);
    }
    return timestamps;
  }

  private async readsTimer(
    framePath: string,
    hudZone: HudZone,
    worker: TesseractWorker,
  ): Promise<boolean> {
    try {
      const image = await Jimp.read(framePath);
      const width = image.getWidth();
      const height = image.getHeight();

      const x = Math.floor(width * hudZone.x);
      const y = Math.floor(height * hudZone.y);
      const w = Math.max(1, Math.floor(width * hudZone.width));
      const h = Math.max(1, Math.floor(height * hudZone.height));

      const crop = image
        .clone()
        .crop(x, y, w, h)
        .resize(w * 4, h * 4)
        .grayscale()
        .contrast(0.6)
        .invert();

      const buffer = await crop.getBufferAsync('image/png');
      const result = await worker.recognize(buffer);
      const text = result.data.text.trim().replace(/\s+/g, '');

      // Timer SSBU : un ou deux chiffres, séparateur, deux chiffres.
      return /\d[:.]\d\d/.test(text);
    } catch (err) {
      this.logger.debug(`OCR frame échouée: ${(err as Error).message}`);
      return false;
    }
  }
}
