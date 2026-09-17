import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FrameSignal } from '../../domain/alignment/alignment.types';

/**
 * Extraction bas coût du signal temporel d'une VOD.
 *
 * L'ancien détecteur écrivait un JPEG par seconde sur disque puis le relisait
 * avec Jimp. Ici les frames sont décodées en niveaux de gris, réduites par
 * FFmpeg lui-même, et streamées en rawvideo sur stdout : rien ne touche le
 * disque et le traitement se fait sur des `Buffer` bruts. C'est un à deux
 * ordres de grandeur plus rapide, ce qui rend une passe complète sur toute la
 * VOD abordable et supprime le besoin de découper en chunks.
 */

/** Résolution de travail. Assez fine pour la zone HUD, assez petite pour être gratuite. */
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;
const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT;

/** Luma au-delà de laquelle un pixel est considéré comme "blanc HUD". */
const BRIGHT_LUMA = 200;
/** Luma en deçà de laquelle un pixel est considéré comme noir. */
const DARK_LUMA = 24;
/** Sous-échantillonnage pour la mesure de noirceur globale. */
const DARK_SAMPLE_STEP = 7;

/** Zone du HUD, en fractions de la frame. Défaut repris du détecteur OCR. */
export interface HudZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_HUD_ZONE: HudZone = {
  x: 0.765,
  y: 0.014,
  width: 0.22,
  height: 0.078,
};

export interface SignalOptions {
  /** Échantillons par seconde. 1 suffit : les games durent des dizaines de secondes. */
  sampleRate?: number;
  startSeconds?: number;
  endSeconds?: number;
  hudZone?: HudZone;
  /**
   * Ne décode que les keyframes. Sur une VOD Twitch (keyframe toutes les ~2s)
   * la passe est environ dix fois plus rapide, au prix d'une précision
   * temporelle de l'ordre de la seconde. Les games durent des minutes et les
   * clips ont de toute façon un pré-roll, donc le compromis est bon — c'est ce
   * qui rend l'alignement viable sur une petite machine.
   *
   * Le filtre `fps` duplique les frames manquantes, donc la correspondance
   * index ↔ timestamp reste exacte.
   */
  keyframesOnly?: boolean;
  /** Appelé périodiquement avec la progression 0-1. */
  onProgress?: (ratio: number) => void;
}

interface PixelZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixels: number;
}

@Injectable()
export class FrameSignalService {
  private readonly logger = new Logger(FrameSignalService.name);

  /**
   * Décode la VOD une fois et renvoie, par échantillon, la densité de pixels
   * clairs dans la zone HUD et la densité de pixels sombres sur la frame.
   */
  async computeSignal(
    videoPath: string,
    options: SignalOptions = {},
  ): Promise<FrameSignal> {
    const sampleRate = options.sampleRate ?? 1;
    const startSeconds = options.startSeconds ?? 0;
    const zone = this.toPixelZone(options.hudZone ?? DEFAULT_HUD_ZONE);

    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
    // Doit précéder -i : c'est une option de décodeur, pas de sortie.
    if (options.keyframesOnly) args.push('-skip_frame', 'nokey');
    if (startSeconds > 0) args.push('-ss', String(startSeconds));
    args.push('-i', videoPath);
    if (options.endSeconds != null) {
      args.push('-t', String(Math.max(0, options.endSeconds - startSeconds)));
    }
    args.push(
      '-an',
      '-sn',
      '-vf',
      `fps=${sampleRate},scale=${FRAME_WIDTH}:${FRAME_HEIGHT},format=gray`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    );

    this.logger.log(
      `📡 Extraction du signal ${videoPath} [${startSeconds}s→${options.endSeconds ?? 'fin'}] @${sampleRate}Hz`,
    );

    const hud: number[] = [];
    const dark: number[] = [];
    const expectedFrames =
      options.endSeconds != null
        ? Math.max(1, (options.endSeconds - startSeconds) * sampleRate)
        : 0;

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      let pending: Buffer = Buffer.alloc(0);
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

        while (pending.length >= FRAME_BYTES) {
          const frame = pending.subarray(0, FRAME_BYTES);
          const measured = this.analyzeFrame(frame, zone);
          hud.push(measured.hud);
          dark.push(measured.dark);
          pending = pending.subarray(FRAME_BYTES);

          if (options.onProgress && expectedFrames > 0 && hud.length % 300 === 0) {
            options.onProgress(Math.min(1, hud.length / expectedFrames));
          }
        }
      });

      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('error', (err) =>
        reject(new Error(`FFmpeg introuvable ou non exécutable: ${err.message}`)),
      );

      proc.on('close', (code) => {
        if (code === 0 || hud.length > 0) resolve();
        else reject(new Error(`FFmpeg a échoué (code ${code}): ${stderr.trim()}`));
      });
    });

    this.logger.log(`📈 ${hud.length} échantillons extraits`);

    return {
      sampleRate,
      startSeconds,
      hud: Uint8Array.from(hud),
      dark: Uint8Array.from(dark),
    };
  }

  /**
   * Extrait quelques frames pleine résolution à des timestamps précis, pour la
   * validation OCR. Un seul appel FFmpeg par frame, mais on n'en demande qu'une
   * poignée par game au lieu d'une par seconde.
   */
  async extractFramesAt(
    videoPath: string,
    timestamps: number[],
  ): Promise<Array<{ timestamp: number; filePath: string; cleanup: () => void }>> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod_ocr_'));
    const results: Array<{
      timestamp: number;
      filePath: string;
      cleanup: () => void;
    }> = [];

    for (const timestamp of timestamps) {
      const filePath = path.join(dir, `f_${Math.round(timestamp)}.png`);
      const ok = await this.extractSingleFrame(videoPath, timestamp, filePath);
      if (ok) {
        results.push({
          timestamp,
          filePath,
          cleanup: () => {
            try {
              fs.unlinkSync(filePath);
            } catch {
              /* déjà supprimé */
            }
          },
        });
      }
    }

    return results;
  }

  /** Supprime un dossier temporaire créé par `extractFramesAt`. */
  cleanupDir(filePath: string): void {
    try {
      fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    } catch {
      /* rien à nettoyer */
    }
  }

  private extractSingleFrame(
    videoPath: string,
    seekSeconds: number,
    outputPath: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(Math.max(0, seekSeconds)),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-y',
        outputPath,
      ]);
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outputPath)));
    });
  }

  private toPixelZone(zone: HudZone): PixelZone {
    const x0 = Math.max(0, Math.floor(FRAME_WIDTH * zone.x));
    const y0 = Math.max(0, Math.floor(FRAME_HEIGHT * zone.y));
    const x1 = Math.min(FRAME_WIDTH, Math.ceil(FRAME_WIDTH * (zone.x + zone.width)));
    const y1 = Math.min(
      FRAME_HEIGHT,
      Math.ceil(FRAME_HEIGHT * (zone.y + zone.height)),
    );
    const pixels = Math.max(1, (x1 - x0) * (y1 - y0));
    return { x0, y0, x1, y1, pixels };
  }

  /** Renvoie les deux mesures quantifiées 0-255. */
  private analyzeFrame(frame: Buffer, zone: PixelZone): { hud: number; dark: number } {
    let bright = 0;
    for (let y = zone.y0; y < zone.y1; y++) {
      const row = y * FRAME_WIDTH;
      for (let x = zone.x0; x < zone.x1; x++) {
        if (frame[row + x] > BRIGHT_LUMA) bright++;
      }
    }

    let darkCount = 0;
    let sampled = 0;
    for (let i = 0; i < FRAME_BYTES; i += DARK_SAMPLE_STEP) {
      if (frame[i] < DARK_LUMA) darkCount++;
      sampled++;
    }

    return {
      hud: Math.round((bright / zone.pixels) * 255),
      dark: sampled > 0 ? Math.round((darkCount / sampled) * 255) : 0,
    };
  }
}
