import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CLIP_SET_QUEUE, CLIP_SET_JOB } from './queue.constants';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';

export interface ClipSetJobData {
  vodId: string;
  setOrder: number;
  setStartGGId?: string;
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
  totalSets: number;
}

@Processor(CLIP_SET_QUEUE, { concurrency: 4 })
export class ClipSetProcessor extends WorkerHost {
  private readonly logger = new Logger(ClipSetProcessor.name);

  constructor(
    @Inject(VOD_CLIPPER_TOKEN)
    private readonly clipper: IVodClipper,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name === CLIP_SET_JOB) {
      return this.processClipSet(job as Job<ClipSetJobData>);
    }
  }

  private async processClipSet(job: Job<ClipSetJobData>): Promise<void> {
    const { vodId, setOrder, setStartGGId, inputPath, outputPath, startSeconds, endSeconds } = job.data;

    this.logger.log(`✂️ [Job ${job.id}] Set ${setOrder} de VOD ${vodId}: [${startSeconds}s → ${endSeconds}s]`);

    const result = await this.clipper.clip({ inputPath, outputPath, startSeconds, endSeconds });

    await this.clipRepository.create({
      vodId,
      setOrder,
      setStartGGId,
      filePath: result.outputPath,
      startSeconds,
      endSeconds,
      status: 'PENDING',
    });

    this.logger.log(`✅ [Job ${job.id}] Set ${setOrder} clipé: ${result.outputPath}`);

    // Vérifier si tous les clips de cette VOD sont terminés
    const clips = await this.clipRepository.findByVodId(vodId);
    const vod = await this.vodRepository.findById(vodId);
    if (vod && clips.length >= (job.data.totalSets ?? 1)) {
      await this.vodRepository.update(vodId, { status: VodStatus.COMPLETED });
      this.logger.log(`🏁 VOD ${vodId} COMPLETED (${clips.length} clips)`);
    }
  }
}
