import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { CLIP_SET_QUEUE, CLIP_SET_JOB } from '../../infrastructure/queues/queue.constants';
import { ClipSetJobData } from '../../infrastructure/queues/clip-set.processor';

export interface GenerateClipsFromTimestampsInput {
  vodId: string;
  eventStartGGId?: string;
  streamName?: string;
  /** Unix timestamp (seconds) of the stream start — overrides vod.recordedAt */
  vodRecordedAtUnix?: number;
  preBufferSeconds?: number;
  postBufferSeconds?: number;
}

export interface GenerateClipsFromTimestampsResult {
  vodId: string;
  enqueuedSets: number;
  skippedSets: number; // sets without startedAt/completedAt
  message: string;
}

@Injectable()
export class GenerateClipsFromTimestampsUseCase {
  private readonly logger = new Logger(GenerateClipsFromTimestampsUseCase.name);
  private readonly storageDir = path.join(process.cwd(), 'storage', 'clips');

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
    @InjectQueue(CLIP_SET_QUEUE)
    private readonly queue: Queue,
  ) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async execute(input: GenerateClipsFromTimestampsInput): Promise<GenerateClipsFromTimestampsResult> {
    const { vodId, streamName, vodRecordedAtUnix, preBufferSeconds = 60, postBufferSeconds = 30 } = input;

    const vod = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.filePath || !fs.existsSync(vod.filePath)) {
      throw new BadRequestException(`Fichier VOD introuvable. La VOD doit être téléchargée avant le clipping.`);
    }

    const eventStartGGId = input.eventStartGGId ?? (vod as any).eventStartGGId;
    if (!eventStartGGId) throw new BadRequestException('eventStartGGId introuvable : associez un event à la VOD ou fournissez-le dans le body.');

    // Determine recordedAt (Unix seconds)
    let recordedAtUnix: number;
    if (vodRecordedAtUnix !== undefined) {
      recordedAtUnix = vodRecordedAtUnix;
      // Save it on the VOD for future use
      await this.vodRepository.update(vodId, { recordedAt: new Date(vodRecordedAtUnix * 1000) });
    } else if (vod.recordedAt) {
      recordedAtUnix = Math.floor(vod.recordedAt.getTime() / 1000);
    } else {
      throw new BadRequestException(
        `Impossible de calculer les positions des clips : la VOD n'a pas de recordedAt. ` +
        `Fournissez vodRecordedAtUnix pour un calage manuel.`,
      );
    }

    // Fetch sets from Start.gg
    const sets = await this.startGGService.getAllSetsByEventId(eventStartGGId, streamName);
    if (!sets.length) {
      throw new BadRequestException(`Aucun set trouvé pour l'event ${eventStartGGId}`);
    }

    this.logger.log(`🎬 Génération clips VOD ${vodId} — ${sets.length} sets, recordedAt: ${new Date(recordedAtUnix * 1000).toISOString()}`);

    let enqueuedSets = 0;
    let skippedSets = 0;

    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      const setOrder = i + 1;

      if (!set.startTime || !set.endTime) {
        this.logger.warn(`⚠️ Set ${setOrder} (${set.roundName}) sans timestamps — ignoré`);
        skippedSets++;
        continue;
      }

      const setStartUnix = Math.floor(new Date(set.startTime).getTime() / 1000);
      const setEndUnix = Math.floor(new Date(set.endTime).getTime() / 1000);

      const startSeconds = Math.max(0, setStartUnix - recordedAtUnix - preBufferSeconds);
      const endSeconds = setEndUnix - recordedAtUnix + postBufferSeconds;

      if (endSeconds <= startSeconds) {
        this.logger.warn(`⚠️ Set ${setOrder}: timestamps invalides (start=${startSeconds}, end=${endSeconds}) — ignoré`);
        skippedSets++;
        continue;
      }

      const players = `${set.player1.name} vs ${set.player2.name}`;
      const safeRound = (set.roundName ?? `set_${setOrder}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const outputPath = path.join(this.storageDir, `${vodId}_set${setOrder}_${safeRound}.mp4`);

      const jobData: ClipSetJobData & { title?: string; roundName?: string; players?: string; score?: string } = {
        vodId,
        setOrder,
        setStartGGId: set.id,
        inputPath: vod.filePath,
        outputPath,
        startSeconds,
        endSeconds,
        totalSets: sets.length - skippedSets,
        title: `${set.roundName} — ${players}`,
        roundName: set.roundName,
        players,
        score: set.score,
      };

      await this.queue.add(CLIP_SET_JOB, jobData, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });

      this.logger.log(`✅ Set ${setOrder} enqueued: [${startSeconds}s → ${endSeconds}s] — ${players}`);
      enqueuedSets++;
    }

    await this.vodRepository.update(vodId, { status: VodStatus.PROCESSING });

    return {
      vodId,
      enqueuedSets,
      skippedSets,
      message: `${enqueuedSets} clips en cours de génération, ${skippedSets} sets ignorés (pas de timestamps).`,
    };
  }
}
