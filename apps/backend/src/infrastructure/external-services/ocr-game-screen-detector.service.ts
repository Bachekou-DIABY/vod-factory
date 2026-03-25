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
  private readonly quickSkipThreshold = 2.0;

  // Durée minimum d'un game SSBU en compétition (évite les faux END)
  private readonly minGameDurationSeconds = 90;

  // Cooldown après un END avant d'autoriser un nouveau START
  private readonly cooldownAfterEndSeconds = 25;

  // Nombre de frames consécutives sans timer requis pour un END
  // 3 → 5 : les kill screens (~1-2s) et pauses brèves ne déclenchent plus de faux END
  private readonly consecutiveAbsentForEnd = 5;

  // Fenêtre max en secondes pour remonter jusqu'au dernier écran noir lors d'un START
  private readonly blackScreenLookbackMax = 45;

  // Seuil luminosité pour détecter un écran noir (% de pixels sombres)
  private readonly blackScreenDarkThreshold = 0.92;

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

    const worker = await createWorker('eng', 1, {
      cachePath: this.tesseractCachePath,
      logger: () => {},
    });
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789:',
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

      // Améliorations :
      // - lastHudTimestamp : dernier frame où le HUD était visible → END plus précis
      // - lastBlackScreenTimestamp : dernier écran noir → START remonte au vrai début de game
      let lastHudTimestamp = startSeconds;
      let lastBlackScreenTimestamp: number | null = null;

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
          // Charger l'image une seule fois pour toutes les vérifications
          const img = await Jimp.read(framePath);

          // 1. Détection écran noir (transitions SSBU : fin de game, début de game)
          const isBlack = this.checkBlackScreen(img);
          if (isBlack) {
            lastBlackScreenTimestamp = timestamp;
          }

          // 2. Pré-filtre rapide : mesure pixels blancs dans la zone timer
          const timerPct = this.measureTimerZoneFromImage(img);

          let hudVisible: boolean;
          if (isBlack || timerPct < this.quickSkipThreshold) {
            // Pas de HUD possible sur un écran noir ou zone timer quasi-vide
            hudVisible = false;
          } else {
            // Valider avec Tesseract : le timer SSBU doit lire M:SS
            hudVisible = await this.validateTimerOcrFromImage(img, worker);
          }

          this.logger.debug(
            `[${timestamp}s] black=${isBlack} timer=${timerPct.toFixed(2)}% hudVisible=${hudVisible} inGame=${inGame}`,
          );

          // --- Machine à états ---

          if (
            !inGame &&
            hudVisible &&
            timestamp - lastEndTimestamp >= this.cooldownAfterEndSeconds
          ) {
            // START détecté : remonter au dernier écran noir si récent
            // (capture le countdown 3-2-1 GO! et le début de stage intro)
            const startTime =
              lastBlackScreenTimestamp !== null &&
              timestamp - lastBlackScreenTimestamp <= this.blackScreenLookbackMax
                ? lastBlackScreenTimestamp
                : timestamp;

            consecutiveTimerAbsent = 0;
            this.logger.log(
              `🎮 START à ${startTime}s (HUD apparu à ${timestamp}s, black=${lastBlackScreenTimestamp}s, timer=${timerPct.toFixed(2)}%)`,
            );
            events.push({
              type: 'START',
              timestamp: startTime,
              confidence: timerPct / 100,
              detectedText: `timer=${timerPct.toFixed(2)}%`,
            });
            inGame = true;
            lastStartTimestamp = timestamp; // durée min calculée depuis 1er HUD
            lastHudTimestamp = timestamp;
            lastBlackScreenTimestamp = null; // consommé
          } else if (inGame && hudVisible) {
            lastHudTimestamp = timestamp;
            consecutiveTimerAbsent = 0;
          } else if (inGame && !hudVisible) {
            consecutiveTimerAbsent++;

            if (
              consecutiveTimerAbsent >= this.consecutiveAbsentForEnd &&
              timestamp - lastStartTimestamp >= this.minGameDurationSeconds
            ) {
              // END : on marque la fin au dernier frame avec HUD + 1s
              // (pas au frame courant, qui est déjà dans la transition post-game)
              const endTime = lastHudTimestamp + 1;

              this.logger.log(
                `🏁 END à ${endTime}s (dernier HUD: ${lastHudTimestamp}s, absent: ${consecutiveTimerAbsent}s consec.)`,
              );
              events.push({
                type: 'END',
                timestamp: endTime,
                confidence: 1 - timerPct / 100,
                detectedText: `timer=${timerPct.toFixed(2)}%`,
              });
              inGame = false;
              lastEndTimestamp = endTime;
              consecutiveTimerAbsent = 0;
            }
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
   * Détecte un écran noir (transitions SSBU entre games/rounds).
   * Échantillonne 1 pixel sur 10 pour la performance.
   * Un écran "noir" = 92%+ des pixels ont R/G/B < 20.
   */
  private checkBlackScreen(img: Jimp): boolean {
    const data = img.bitmap.data;
    const step = 10; // 1 pixel sur 10
    let darkCount = 0;
    let sampled = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      if (data[i] < 20 && data[i + 1] < 20 && data[i + 2] < 20) {
        darkCount++;
      }
      sampled++;
    }
    return sampled > 0 && darkCount / sampled >= this.blackScreenDarkThreshold;
  }

  /**
   * Mesure le % de pixels blancs dans la zone timer (HUD SSBU).
   * Fast path : si < quickSkipThreshold → pas de HUD, skip OCR.
   * Réutilise l'image déjà chargée (évite un second Jimp.read).
   */
  private measureTimerZoneFromImage(img: Jimp): number {
    const fw = img.getWidth();
    const fh = img.getHeight();

    const tx = Math.floor(fw * this.timerX);
    const ty = Math.floor(fh * this.timerY);
    const tw = Math.floor(fw * this.timerW);
    const th = Math.floor(fh * this.timerH);

    const crop = img.clone().crop(tx, ty, tw, th);

    let white = 0, total = 0;
    crop.scan(0, 0, crop.getWidth(), crop.getHeight(), (x, y, idx) => {
      const r = crop.bitmap.data[idx];
      const g = crop.bitmap.data[idx + 1];
      const b = crop.bitmap.data[idx + 2];
      total++;
      if (r > 200 && g > 200 && b > 200) white++;
    });

    return total > 0 ? (white / total) * 100 : 0;
  }

  /**
   * Valide que la zone timer contient bien un timer SSBU au format M:SS.
   * Réutilise l'image déjà chargée (évite un second Jimp.read).
   */
  private async validateTimerOcrFromImage(
    img: Jimp,
    worker: TesseractWorker,
  ): Promise<boolean> {
    const fw = img.getWidth();
    const fh = img.getHeight();

    const tx = Math.floor(fw * this.timerX);
    const ty = Math.floor(fh * this.timerY);
    const tw = Math.floor(fw * this.timerW);
    const th = Math.floor(fh * this.timerH);

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
