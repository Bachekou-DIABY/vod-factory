import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { VOD_DOWNLOAD_QUEUE, VOD_DOWNLOAD_JOB } from './queue.constants';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodDownloadService, VOD_DOWNLOAD_SERVICE_TOKEN } from '../../domain/interfaces/vod-download-service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { FfprobeService } from '../external-services/ffprobe.service';

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
          if (progress.percent % 10 === 0) {
            this.logger.log(`📥 VOD ${vodId}: ${progress.percent.toFixed(0)}% (${progress.speed})`);
          }
          job.updateProgress(progress.percent).catch(() => undefined);
        },
      );

      const probe = await this.ffprobe.probe(result.filePath);

      await this.vodRepository.update(vodId, {
        filePath: result.filePath,
        status: VodStatus.DOWNLOADED,
        fileSize: result.fileSize,
        duration: probe.duration || result.duration,
        resolution: probe.resolution,
        fps: probe.fps,
        recordedAt: result.recordedAt,
      });

      this.logger.log(`✅ [Job ${job.id}] VOD ${vodId} téléchargée: ${result.filePath}`);
    } catch (err) {
      this.logger.error(`❌ [Job ${job.id}] Erreur download VOD ${vodId}: ${err.message}`);
      await this.vodRepository.updateStatus(vodId, VodStatus.FAILED);
      throw err;
    }
  }
}
