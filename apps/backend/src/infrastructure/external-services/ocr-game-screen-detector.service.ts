import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import Tesseract from 'tesseract.js';
import {
  GameScreenEvent,
  IGameScreenDetector,
} from '../../domain/interfaces/game-screen-detector.interface';

interface FrameAnalysis {
  timestamp: number;
  text: string;
  confidence: number;
}

@Injectable()
export class OcrGameScreenDetector implements IGameScreenDetector {
  private readonly logger = new Logger(OcrGameScreenDetector.name);

  private readonly startKeywords = ['go', 'partez', 'start', 'begin'];
  private readonly endKeywords = ['game', 'fini', 'end', 'finish', 'set'];
  private readonly confidenceThreshold = 0.7;
  private readonly minTextLength = 2;
  private readonly deduplicationWindowSeconds = 5;

  async detectEvents(videoPath: string): Promise<GameScreenEvent[]> {
    this.logger.log(`🔍 Analyse OCR de: ${videoPath}`);

    const tmpDir = path.join(os.tmpdir(), `vod_frames_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await this.extractFrames(videoPath, tmpDir);

      const frameFiles = fs.readdirSync(tmpDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();

      this.logger.log(`📸 ${frameFiles.length} frames extraites`);

      const rawEvents: GameScreenEvent[] = [];

      for (const frameFile of frameFiles) {
        const framePath = path.join(tmpDir, frameFile);
        const timestamp = this.getTimestampFromFilename(frameFile);

        try {
          const analysis = await this.analyzeImage(framePath);
          const event = this.detectEventFromText(analysis.text, analysis.confidence);
          if (event) {
            rawEvents.push({ ...event, timestamp });
          }
        } catch {
          // OCR failure on a single frame is non-fatal, skip it
        }
      }

      const events = this.deduplicateEvents(rawEvents);
      this.logger.log(`✅ Analyse terminée: ${events.length} événements détectés`);
      return events;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private extractFrames(videoPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          // 1 frame/sec, crop zone centrale 30%
          '-vf', 'fps=1,crop=iw*0.3:ih*0.3:iw*0.35:ih*0.35',
          '-q:v', '2',
        ])
        .output(path.join(outputDir, 'frame_%05d.jpg'))
        .on('start', (cmd) => this.logger.debug(`FFmpeg: ${cmd}`))
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`FFmpeg error: ${err.message}`)))
        .run();
    });
  }

  private getTimestampFromFilename(filename: string): number {
    const match = filename.match(/frame_(\d+)\.jpg/);
    return match ? parseInt(match[1], 10) - 1 : 0; // frame_00001 = seconde 0
  }

  private deduplicateEvents(events: GameScreenEvent[]): GameScreenEvent[] {
    const deduplicated: GameScreenEvent[] = [];
    let lastType: string | null = null;
    let lastTimestamp = -this.deduplicationWindowSeconds;

    for (const event of events) {
      if (
        event.type !== lastType ||
        event.timestamp - lastTimestamp >= this.deduplicationWindowSeconds
      ) {
        deduplicated.push(event);
        lastType = event.type;
        lastTimestamp = event.timestamp;
      }
    }

    return deduplicated;
  }

  private async analyzeImage(imagePath: string): Promise<FrameAnalysis> {
    const result = await Tesseract.recognize(imagePath, 'fra+eng');
    return {
      timestamp: 0,
      text: result.data.text.toLowerCase().trim(),
      confidence: result.data.confidence / 100,
    };
  }

  detectEventFromText(text: string, confidence: number): GameScreenEvent | null {
    if (confidence < this.confidenceThreshold) return null;

    const normalizedText = text.toLowerCase().trim();
    if (normalizedText.length < this.minTextLength) return null;

    for (const keyword of this.startKeywords) {
      if (normalizedText.includes(keyword)) {
        return { type: 'START', timestamp: 0, confidence, detectedText: normalizedText };
      }
    }

    for (const keyword of this.endKeywords) {
      if (normalizedText.includes(keyword)) {
        return { type: 'END', timestamp: 0, confidence, detectedText: normalizedText };
      }
    }

    return null;
  }
}
