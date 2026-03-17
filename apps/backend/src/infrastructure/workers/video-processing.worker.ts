import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../domain/queues/queue-tokens';
import { Inject, Injectable } from '@nestjs/common';
import { REPOSITORY_TOKENS } from '../../domain/repositories/injection-tokens';
import { IVodRepository } from '../../domain/repositories/vod.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';

interface VideoProcessingJobData {
  vodId: string;
  sourceUrl: string;
  tournamentId: string;
  setId: string;
}

@Injectable()
@Processor(QUEUE_NAMES.VIDEO_PROCESSING)
export class VideoProcessingWorker extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingWorker.name);

  constructor(
    @Inject(REPOSITORY_TOKENS.VOD)
    private readonly vodRepository: IVodRepository,
  ) {
    super();
    this.logger.log('VideoProcessingWorker initialized and listening to queue...');
  }

  async process(job: Job<VideoProcessingJobData, unknown, string>): Promise<{ success: boolean }> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    
    const { vodId, sourceUrl } = job.data;
    this.logger.log(`VOD ID: ${vodId}, Source: ${sourceUrl}`);
    
    // 1. Marquer comme en cours de traitement
    await this.vodRepository.update(vodId, { status: VodStatus.PROCESSING });
    await job.updateProgress(10);
    
    // Simulation du futur travail de FFmpeg
    // Ici on fera le découpage réel plus tard
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 2. Marquer comme terminé
    await this.vodRepository.update(vodId, { status: VodStatus.COMPLETED });
    await job.updateProgress(100);
    this.logger.log(`Job ${job.id} completed!`);
    
    return { success: true };
  }
}
