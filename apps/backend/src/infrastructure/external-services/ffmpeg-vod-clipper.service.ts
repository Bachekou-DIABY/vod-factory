import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { IVodClipper, ClipOptions, ClipResult } from '../../domain/interfaces/vod-clipper.interface';

@Injectable()
export class FfmpegVodClipper implements IVodClipper {
  private readonly logger = new Logger(FfmpegVodClipper.name);

  async clip(options: ClipOptions): Promise<ClipResult> {
    const { inputPath, outputPath, startSeconds, endSeconds } = options;

    this.logger.log(`✂️ Clipping ${path.basename(inputPath)} [${startSeconds}s → ${endSeconds}s]`);

    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    await this.runFfmpeg(inputPath, outputPath, startSeconds, endSeconds);

    const { size } = fs.statSync(outputPath);
    this.logger.log(`✅ Clip généré: ${outputPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);

    return { outputPath, fileSize: size };
  }

  private runFfmpeg(
    inputPath: string,
    outputPath: string,
    startSeconds: number,
    endSeconds: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(startSeconds)          // seek avant -i (rapide, keyframe)
        .outputOptions([
          '-to', String(endSeconds - startSeconds), // durée relative après seek
          '-c', 'copy',                             // pas de re-encodage
          '-avoid_negative_ts', 'make_zero',        // corrige les timestamps négatifs post-seek
          '-movflags', '+faststart',                // moov atom en tête pour streaming immédiat
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(new Error(`FFmpeg clip error: ${err.message}`)))
        .run();
    });
  }
}
