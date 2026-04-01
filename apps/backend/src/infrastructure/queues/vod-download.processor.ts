import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { VOD_DOWNLOAD_QUEUE, VOD_DOWNLOAD_JOB } from './queue.constants';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodDownloadService, VOD_DOWNLOAD_SERVICE_TOKEN } from '../../domain/interfaces/vod-download-service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { FfprobeService } from '../external-services/ffprobe.service';
import { DownloadProgressService } from './download-progress.service';

export interface VodDownloadJobData {
  vodId: string;
  sourceUrl: string;
}

@Processor(VOD_DOWNLOAD_QUEUE, { concurrency: 2, lockDuration: 60000, maxStalledCount: 3 })
export class VodDownloadProcessor extends WorkerHost {
  private readonly logger = new Logger(VodDownloadProcessor.name);

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(VOD_DOWNLOAD_SERVICE_TOKEN)
    private readonly downloadService: IVodDownloadService,
    private readonly ffprobe: FfprobeService,
    private readonly downloadProgress: DownloadProgressService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name === VOD_DOWNLOAD_JOB) {
      return this.processDownload(job as Job<VodDownloadJobData>);
    }
  }

  private async processDownload(job: Job<VodDownloadJobData>): Promise<void> {
    const { vodId, sourceUrl } = job.data;
    this.logger.log(`⬇️ [Job ${job.id}] Téléchargement VOD ${vodId}`);

    try {
      const result = await this.downloadService.download(
        sourceUrl,
        undefined,
        (progress) => {
          this.downloadProgress.set(vodId, progress.percent);
          if (Math.round(progress.percent) % 5 === 0) {
            this.logger.log(`📥 VOD ${vodId}: ${progress.percent.toFixed(0)}% (${progress.speed})`);
          }
        },
      );

      const probe = await this.ffprobe.probe(result.filePath);

      // Remux faststart uniquement si nécessaire (moov atom pas encore en tête)
      let remuxedPath = result.filePath;
      if (!this.isFaststart(result.filePath)) {
        this.logger.log(`🔄 Faststart manquant, remux en cours...`);
        await this.vodRepository.updateStatus(vodId, VodStatus.PROCESSING);
        remuxedPath = await this.remuxFaststart(result.filePath);
      } else {
        this.logger.log(`✅ Faststart déjà appliqué par yt-dlp, remux ignoré`);
      }

      await this.vodRepository.update(vodId, {
        filePath: remuxedPath,
        status: VodStatus.DOWNLOADED,
        fileSize: fs.existsSync(remuxedPath) ? fs.statSync(remuxedPath).size : result.fileSize,
        duration: probe.duration || result.duration,
        resolution: probe.resolution,
        fps: probe.fps,
        recordedAt: result.recordedAt,
      });

      this.downloadProgress.clear(vodId);
      this.logger.log(`✅ [Job ${job.id}] VOD ${vodId} prête: ${remuxedPath}`);
    } catch (err) {
      this.downloadProgress.clear(vodId);
      this.logger.error(`❌ [Job ${job.id}] Erreur download VOD ${vodId}: ${err.message}`);
      await this.vodRepository.updateStatus(vodId, VodStatus.FAILED);
      throw err;
    }
  }

  private isFaststart(filePath: string): boolean {
    // Dans un MP4, faststart = moov avant mdat.
    // Le premier box est toujours ftyp, donc on lit les 2 premiers boxes
    // pour vérifier si le second est moov (faststart) ou mdat/autre (pas faststart).
    try {
      const fd = fs.openSync(filePath, 'r');
      const header = Buffer.alloc(8);
      let offset = 0;

      for (let i = 0; i < 5; i++) {
        fs.readSync(fd, header, 0, 8, offset);
        const size = header.readUInt32BE(0);
        const type = header.slice(4, 8).toString('ascii');
        if (type === 'moov') { fs.closeSync(fd); return true; }
        if (type === 'mdat') { fs.closeSync(fd); return false; }
        if (size < 8) break;
        offset += size;
      }

      fs.closeSync(fd);
      return false;
    } catch {
      return false;
    }
  }

  private remuxFaststart(inputPath: string): Promise<string> {
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);
    const outputPath = path.join(dir, `${base}_fs${ext}`);

    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-i', inputPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ]);

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          try { fs.unlinkSync(inputPath); } catch (_) { /* ignore */ }
          this.logger.log(`⚡ Faststart appliqué: ${path.basename(outputPath)}`);
          resolve(outputPath);
        } else {
          this.logger.warn(`⚠️ Remux faststart échoué (code ${code}), fichier original conservé`);
          resolve(inputPath);
        }
      });

      proc.on('error', () => {
        this.logger.warn(`⚠️ ffmpeg indisponible pour remux, fichier original conservé`);
        resolve(inputPath);
      });
    });
  }
}
