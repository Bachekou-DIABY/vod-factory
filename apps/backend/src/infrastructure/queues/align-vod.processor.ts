import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AlignVodSetsUseCase,
  AlignVodSetsInput,
} from '../../application/use-cases/align-vod-sets.usecase';
import { VOD_ALIGN_QUEUE, ALIGN_VOD_JOB } from './queue.constants';

export type AlignVodJobData = AlignVodSetsInput;

/**
 * L'alignement décode toute la VOD une fois : c'est long, donc asynchrone.
 * Concurrence 1 : le décodage est déjà limité par le CPU et deux passes
 * simultanées se ralentiraient mutuellement sans rien gagner.
 */
@Processor(VOD_ALIGN_QUEUE, { concurrency: 1, lockDuration: 3_600_000 })
export class AlignVodProcessor extends WorkerHost {
  private readonly logger = new Logger(AlignVodProcessor.name);

  constructor(private readonly alignVodSets: AlignVodSetsUseCase) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== ALIGN_VOD_JOB) return undefined;

    const data = job.data as AlignVodJobData;
    this.logger.log(`🎯 [Job ${job.id}] Alignement VOD ${data.vodId}`);

    const report = await this.alignVodSets.execute(data);

    this.logger.log(
      `✅ [Job ${job.id}] VOD ${data.vodId}: ${report.setsFromVideo}/${report.setsTotal} sets calés sur la vidéo`,
    );

    // Le rapport complet est en base ; on ne garde ici que le résumé.
    return {
      vodId: report.vodId,
      biasSeconds: report.biasSeconds,
      setsTotal: report.setsTotal,
      setsFromVideo: report.setsFromVideo,
      setsPartial: report.setsPartial,
      setsFromApiOnly: report.setsFromApiOnly,
    };
  }
}
