import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import Jimp from 'jimp';
import {
  GameScreenEvent,
  IGameScreenDetector,
} from '../../domain/interfaces/game-screen-detector.interface';

@Injectable()
export class OcrGameScreenDetector implements IGameScreenDetector {
  private readonly logger = new Logger(OcrGameScreenDetector.name);

  // Zone timer en haut à droite (HUD SSBU : chrono blanc sur fond sombre)
  // Frame 640x360 → timer ≈ x=490, y=5, w=145, h=28
  private readonly timerX = 0.765;
  private readonly timerY = 0.014;
  private readonly timerW = 0.220;
  private readonly timerH = 0.078;

  // % de pixels blancs dans la zone timer au-dessus duquel le HUD est visible
  private readonly timerVisibleThreshold = 3.0;

  // Durée minimum d'un game SSBU en compétition (évite les faux END)
  private readonly minGameDurationSeconds = 90;

  // Cooldown après un END avant d'autoriser un nouveau START
  // (l'écran résultats après GAME! a du blanc dans la zone timer pendant ~2s)
  // Le vrai délai minimum entre END et prochain START est 31s sur cette VOD
  private readonly cooldownAfterEndSeconds = 25;

  async detectEvents(videoPath: string): Promise<GameScreenEvent[]> {
    this.logger.log(`🔍 Analyse: ${videoPath}`);

    const tmpDir = path.join(os.tmpdir(), `vod_frames_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await this.extractFrames(videoPath, tmpDir);

      const frameFiles = fs.readdirSync(tmpDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();

      const total = frameFiles.length;
      this.logger.log(`📸 ${total} frames extraites`);

      const events: GameScreenEvent[] = [];
      let inGame = false;
      let lastStartTimestamp = -this.minGameDurationSeconds;
      let lastEndTimestamp = -this.cooldownAfterEndSeconds;
      let consecutiveTimerAbsent = 0;

      for (let i = 0; i < total; i++) {
        const frameFile = frameFiles[i];
        const framePath = path.join(tmpDir, frameFile);
        const timestamp = this.getTimestampFromFilename(frameFile);

        if (i % 100 === 0) {
          this.logger.log(`⏳ ${i}/${total} frames (${Math.round(i / total * 100)}%)`);
        }

        try {
          const timerPct = await this.measureTimerZone(framePath);
          const hudVisible = timerPct > this.timerVisibleThreshold;

          this.logger.debug(`[${timestamp}s] timer=${timerPct.toFixed(2)}% hudVisible=${hudVisible} inGame=${inGame}`);

          if (!inGame && hudVisible && timestamp - lastEndTimestamp >= this.cooldownAfterEndSeconds) {
            // Transition : pas de HUD → HUD visible = début de game
            // (ignoré si dans le cooldown post-END : écran résultats avec pixels blancs parasites)
            consecutiveTimerAbsent = 0;
            this.logger.log(`🎮 START à ${timestamp}s (timer=${timerPct.toFixed(2)}%)`);
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
            if (consecutiveTimerAbsent >= 3 && timestamp - lastStartTimestamp >= this.minGameDurationSeconds) {
              this.logger.log(`🏁 END à ${timestamp}s (timer absent ${consecutiveTimerAbsent}s consécutives)`);
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
            // Timer toujours visible → reset le compteur (kill screen terminé, game continue)
            consecutiveTimerAbsent = 0;
          }
        } catch (err) {
          this.logger.warn(`⚠️ Erreur frame ${timestamp}s: ${err.message}`);
        }
      }

      this.logger.log(`✅ ${events.length} événements détectés`);
      return events;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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

    let white = 0, total = 0;

    crop.scan(0, 0, crop.getWidth(), crop.getHeight(), (x, y, idx) => {
      const r = crop.bitmap.data[idx];
      const g = crop.bitmap.data[idx + 1];
      const b = crop.bitmap.data[idx + 2];
      total++;
      // Pixels blancs/lumineux = chiffres du timer
      if (r > 200 && g > 200 && b > 200) white++;
    });

    return (white / total) * 100;
  }

  private extractFrames(videoPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions(['-vf', 'fps=1', '-q:v', '2'])
        .output(path.join(outputDir, 'frame_%05d.jpg'))
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
        .run();
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
