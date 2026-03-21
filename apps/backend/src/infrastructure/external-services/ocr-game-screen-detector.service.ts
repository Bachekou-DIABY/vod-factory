import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import Jimp from 'jimp';
import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import {
  GameScreenEvent,
  IGameScreenDetector,
} from '../../domain/interfaces/game-screen-detector.interface';

@Injectable()
export class OcrGameScreenDetector implements IGameScreenDetector {
  private readonly logger = new Logger(OcrGameScreenDetector.name);

  // Zone timer en haut à droite (HUD SSBU)
  // Frame 640x360 → timer ≈ x=490, y=5, w=145, h=28
  private readonly timerX = 0.765;
  private readonly timerY = 0.014;
  private readonly timerW = 0.220;
  private readonly timerH = 0.078;

  // Seuil de pré-filtre rapide (pixels blancs < N% → pas de HUD, skip OCR)
  // 2% évite les faux positifs sur zones quasi-noires où invert() génère du bruit Tesseract
  private readonly quickSkipThreshold = 2.0;

  // Durée minimum d'un game SSBU en compétition (évite les faux END)
  private readonly minGameDurationSeconds = 90;

  // Cooldown après un END avant d'autoriser un nouveau START
  private readonly cooldownAfterEndSeconds = 25;

  // Dossier de cache Tesseract (évite de re-télécharger le modèle à chaque run)
  private readonly tesseractCachePath = path.join(
    process.cwd(),
    '.tesseract-cache',
  );

  async detectEvents(
    videoPath: string,
    startSeconds = 0,
    endSeconds?: number,
  ): Promise<GameScreenEvent[]> {
    const rangeLabel =
      endSeconds != null ? `[${startSeconds}s→${endSeconds}s]` : '[complet]';
    this.logger.log(`🔍 Analyse ${rangeLabel}: ${videoPath}`);

    const tmpDir = path.join(os.tmpdir(), `vod_frames_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(this.tesseractCachePath, { recursive: true });

    // Initialiser le worker Tesseract (1 par chunk, lang data cachée sur disque)
    const worker = await createWorker('eng', 1, {
      cachePath: this.tesseractCachePath,
      logger: () => {}, // supprime les logs verbeux de Tesseract
    });
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789:',
      // PSM 7 = single text line
      tessedit_pageseg_mode: '7' as any,
    });

    try {
      await this.extractFrames(videoPath, tmpDir, startSeconds, endSeconds);

      const frameFiles = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith('.jpg'))
        .sort();

      const total = frameFiles.length;
      this.logger.log(`📸 ${total} frames extraites ${rangeLabel}`);

      const events: GameScreenEvent[] = [];
      let inGame = false;
      let lastStartTimestamp = startSeconds - this.minGameDurationSeconds;
      let lastEndTimestamp = startSeconds - this.cooldownAfterEndSeconds;
      let consecutiveTimerAbsent = 0;

      for (let i = 0; i < total; i++) {
        const frameFile = frameFiles[i];
        const framePath = path.join(tmpDir, frameFile);
        const timestamp =
          startSeconds + this.getTimestampFromFilename(frameFile);

        if (i % 100 === 0) {
          this.logger.log(
            `⏳ ${i}/${total} frames (${Math.round((i / total) * 100)}%)`,
          );
        }

        try {
          const timerPct = await this.measureTimerZone(framePath);
          let hudVisible: boolean;

          if (timerPct < this.quickSkipThreshold) {
            // Clairement pas de HUD → skip OCR (fast path)
            hudVisible = false;
          } else {
            // Valider avec Tesseract : le timer SSBU doit lire un format M:SS
            // L'overlay du stream (même s'il est blanc) ne ressemble pas à "7:00"
            hudVisible = await this.validateTimerOcr(framePath, worker);
          }

          this.logger.debug(
            `[${timestamp}s] timer=${timerPct.toFixed(2)}% hudVisible=${hudVisible} inGame=${inGame}`,
          );

          if (
            !inGame &&
            hudVisible &&
            timestamp - lastEndTimestamp >= this.cooldownAfterEndSeconds
          ) {
            consecutiveTimerAbsent = 0;
            this.logger.log(
              `🎮 START à ${timestamp}s (timer=${timerPct.toFixed(2)}%)`,
            );
            events.push({
              type: 'START',
              timestamp,
              confidence: timerPct / 100,
              detectedText: `timer=${timerPct.toFixed(2)}%`,
            });
            inGame = true;
            lastStartTimestamp = timestamp;
          } else if (inGame && !hudVisible) {
            consecutiveTimerAbsent++;
            // Exiger 3 frames consécutives sans timer :
            // kill screen (~1-2s) → ignoré
            // GAME! screen + transition (10s+) → détecté
            if (
              consecutiveTimerAbsent >= 3 &&
              timestamp - lastStartTimestamp >= this.minGameDurationSeconds
            ) {
              this.logger.log(
                `🏁 END à ${timestamp}s (timer absent ${consecutiveTimerAbsent}s consécutives)`,
              );
              events.push({
                type: 'END',
                timestamp,
                confidence: 1 - timerPct / 100,
                detectedText: `timer=${timerPct.toFixed(2)}%`,
              });
              inGame = false;
              lastEndTimestamp = timestamp;
              consecutiveTimerAbsent = 0;
            }
          } else if (inGame && hudVisible) {
            consecutiveTimerAbsent = 0;
          }
        } catch (err) {
          this.logger.warn(`⚠️ Erreur frame ${timestamp}s: ${err.message}`);
        }
      }

      this.logger.log(`✅ ${events.length} événements détectés`);
      return events;
    } finally {
      await worker.terminate();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Valide que la zone timer contient bien un timer SSBU au format M:SS
   * en utilisant Tesseract OCR sur l'image préprocessée.
   * Beaucoup plus précis que le simple comptage de pixels blancs.
   */
  private async validateTimerOcr(
    framePath: string,
    worker: TesseractWorker,
  ): Promise<boolean> {
    const img = await Jimp.read(framePath);
    const fw = img.getWidth();
    const fh = img.getHeight();

    const tx = Math.floor(fw * this.timerX);
    const ty = Math.floor(fh * this.timerY);
    const tw = Math.floor(fw * this.timerW);
    const th = Math.floor(fh * this.timerH);

    // Préprocessing : crop → upscale 4x → grayscale → contraste → inversion
    // (Tesseract lit mieux du texte sombre sur fond clair)
    const crop = img
      .clone()
      .crop(tx, ty, tw, th)
      .resize(tw * 4, th * 4)
      .grayscale()
      .contrast(0.6)
      .invert();

    const buffer = await crop.getBufferAsync('image/png');
    const result = await worker.recognize(buffer);
    const text = result.data.text.trim().replace(/\s+/g, '');

    // Timer SSBU valide : digit(s) + séparateur + 2 digits (ex: "7:00", "3:42", "0:05")
    const isTimer = /\d[:.]\d\d/.test(text);

    this.logger.debug(
      `[OCR timer] "${text}" → ${isTimer ? '✅ timer' : '❌ non-timer'}`,
    );

    return isTimer;
  }

  private async measureTimerZone(framePath: string): Promise<number> {
    const img = await Jimp.read(framePath);
    const fw = img.getWidth();
    const fh = img.getHeight();

    const tx = Math.floor(fw * this.timerX);
    const ty = Math.floor(fh * this.timerY);
    const tw = Math.floor(fw * this.timerW);
    const th = Math.floor(fh * this.timerH);

    const crop = img.clone().crop(tx, ty, tw, th);

    let white = 0,
      total = 0;

    crop.scan(0, 0, crop.getWidth(), crop.getHeight(), (x, y, idx) => {
      const r = crop.bitmap.data[idx];
      const g = crop.bitmap.data[idx + 1];
      const b = crop.bitmap.data[idx + 2];
      total++;
      if (r > 200 && g > 200 && b > 200) white++;
    });

    return (white / total) * 100;
  }

  private extractFrames(
    videoPath: string,
    outputDir: string,
    startSeconds = 0,
    endSeconds?: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const outputPattern = path.join(outputDir, 'frame_%05d.jpg');
      const args: string[] = [];

      if (startSeconds > 0) {
        args.push('-ss', startSeconds.toString());
      }
      if (endSeconds != null) {
        args.push('-t', (endSeconds - startSeconds).toString());
      }

      args.push(
        '-i',
        videoPath,
        '-vf',
        'fps=1',
        '-q:v',
        '2',
        outputPattern,
      );

      const proc = spawn('ffmpeg', args);

      proc.stderr.on('data', (data) => {
        this.logger.debug(`ffmpeg: ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });
  }

  private getTimestampFromFilename(filename: string): number {
    const match = filename.match(/frame_(\d+)\.jpg/);
    return match ? parseInt(match[1], 10) - 1 : 0;
  }

  // kept for interface compatibility
  detectEventFromText(text: string, confidence: number): GameScreenEvent | null {
    return null;
  }
}
