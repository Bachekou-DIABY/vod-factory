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

    // Fallback to stream name stored on the VOD
    const resolvedStreamName = streamName ?? (vod as any).streamName;

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

    // Fetch sets from Start.gg — only on-stream sets
    const allSets = await this.startGGService.getAllSetsByEventId(eventStartGGId, resolvedStreamName);
    // When no streamName filter, still restrict to sets that were actually on stream
    const sets = resolvedStreamName
      ? allSets
      : allSets.filter((s) => s.stream);
    if (!sets.length) {
      throw new BadRequestException(`Aucun set on-stream trouvé pour l'event ${eventStartGGId}`);
    }

    // VOD end time — used to discard sets that belong to a different stream/day
    const vodDurationSeconds = (vod as any).duration ?? 0;
    const vodEndUnix = vodDurationSeconds > 0 ? recordedAtUnix + vodDurationSeconds : null;

    this.logger.log(`🎬 Génération clips VOD ${vodId} — ${sets.length} sets, recordedAt: ${new Date(recordedAtUnix * 1000).toISOString()}${vodEndUnix ? `, fin: ${new Date(vodEndUnix * 1000).toISOString()}` : ''}`);

    let enqueuedSets = 0;
    let skippedSets = 0;

    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      const setOrder = i + 1;

      const isLastSet = i === sets.length - 1;

      // Last set without endTime → use VOD end instead of skipping
      if (!set.startTime || (!set.endTime && !(isLastSet && vodDurationSeconds > 0))) {
        this.logger.warn(`⚠️ Set ${setOrder} (${set.roundName}) sans timestamps — ignoré`);
        skippedSets++;
        continue;
      }

      const setStartUnix = Math.floor(new Date(set.startTime!).getTime() / 1000);

      // Skip sets that start after the VOD ends (belong to another day/stream)
      if (vodEndUnix && setStartUnix > vodEndUnix) {
        this.logger.warn(`⚠️ Set ${setOrder} (${set.roundName}) commence après la fin de la VOD — ignoré`);
        skippedSets++;
        continue;
      }

      const startSeconds = Math.max(0, setStartUnix - recordedAtUnix - preBufferSeconds);

      // If no endTime on last set → extend to end of VOD to capture the full game
      let endSeconds: number;
      if (!set.endTime && isLastSet && vodDurationSeconds > 0) {
        endSeconds = vodDurationSeconds;
        this.logger.log(`⏭️ Set ${setOrder}: pas d'endTime, clip étendu jusqu'à la fin de la VOD (${vodDurationSeconds}s)`);
      } else {
        const setEndUnix = Math.floor(new Date(set.endTime!).getTime() / 1000);
        const calculatedEnd = setEndUnix - recordedAtUnix + postBufferSeconds;
        endSeconds = vodDurationSeconds > 0 ? Math.min(calculatedEnd, vodDurationSeconds) : calculatedEnd;
      }

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
        title: `${set.phaseName ? `${set.phaseName} - ` : ''}${set.roundName} — ${players}`,
        roundName: set.phaseName ? `${set.phaseName} - ${set.roundName}` : set.roundName,
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
