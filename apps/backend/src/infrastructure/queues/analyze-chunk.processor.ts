import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../persistence/prisma.service';
import { IGameScreenDetector, GAME_SCREEN_DETECTOR_TOKEN, GameScreenEvent } from '../../domain/interfaces/game-screen-detector.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { VOD_PROCESSING_QUEUE, ANALYZE_CHUNK_JOB } from './queue.constants';

export interface AnalyzeChunkJobData {
  vodId: string;
  chunkIndex: number;
  totalChunks: number;
  startSeconds: number;
  endSeconds: number;
  filePath: string;
}

@Processor(VOD_PROCESSING_QUEUE, { concurrency: 4, lockDuration: 600000 })
export class AnalyzeChunkProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyzeChunkProcessor.name);

  constructor(
    @Inject(GAME_SCREEN_DETECTOR_TOKEN)
    private readonly detector: IGameScreenDetector,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name === ANALYZE_CHUNK_JOB) {
      return this.processChunk(job as Job<AnalyzeChunkJobData>);
    }
  }

  private async processChunk(job: Job<AnalyzeChunkJobData>): Promise<void> {
    const { vodId, chunkIndex, totalChunks, startSeconds, endSeconds, filePath } = job.data;

    this.logger.log(`🔍 [Job ${job.id}] Chunk ${chunkIndex + 1}/${totalChunks} VOD ${vodId} [${startSeconds}s→${endSeconds}s]`);

    const events = await this.detector.detectEvents(filePath, startSeconds, endSeconds);

    this.logger.log(`✅ [Chunk ${chunkIndex + 1}] ${events.length} events détectés`);

    // Sauvegarder les events de ce chunk
    const db = this.prisma as any;
    await db.vodChunkEvent.upsert({
      where: { vodId_chunkIndex: { vodId, chunkIndex } },
      create: { vodId, chunkIndex, events: events as any },
      update: { events: events as any },
    });

    // Incrémenter completedChunks atomiquement
    const updated = await db.vod.update({
      where: { id: vodId },
      data: { completedChunks: { increment: 1 } },
      select: { completedChunks: true },
    });

    this.logger.log(`📊 VOD ${vodId}: ${updated.completedChunks}/${totalChunks} chunks terminés`);

    // Si dernier chunk → merge + finalisation
    if (updated.completedChunks >= totalChunks) {
      await this.finalizeAnalysis(vodId, totalChunks);
    }
  }

  private async finalizeAnalysis(vodId: string, totalChunks: number): Promise<void> {
    const db = this.prisma as any;

    // Guard against concurrent finalization: atomically set completedChunks to -1 as sentinel
    const claimed = await db.vod.updateMany({
      where: { id: vodId, status: VodStatus.PROCESSING, completedChunks: totalChunks },
      data: { completedChunks: -1 },
    });
    if (claimed.count === 0) return;

    this.logger.log(`🔀 Merge des chunks pour VOD ${vodId}`);

    // Récupérer tous les chunks dans l'ordre
    const chunkRecords = await db.vodChunkEvent.findMany({
      where: { vodId },
      orderBy: { chunkIndex: 'asc' },
    });

    // Aplatir et trier par timestamp
    const allEvents: GameScreenEvent[] = chunkRecords
      .flatMap((r: any) => r.events as GameScreenEvent[])
      .sort((a: GameScreenEvent, b: GameScreenEvent) => a.timestamp - b.timestamp);

    // Dédupliquer les events en frontière de chunks (fenêtre 5s)
    const deduped = this.deduplicateEvents(allEvents);

    this.logger.log(`🎮 ${deduped.length} events après merge/dédup (${allEvents.length} bruts)`);

    // Compter les games
    const gamesDetected = this.countGames(deduped);
    this.logger.log(`🏆 ${gamesDetected} games détectés au total`);

    // Persister les events finaux sur la VOD
    const firstStart = deduped.find(e => e.type === 'START');
    const lastEnd = [...deduped].reverse().find(e => e.type === 'END');

    await this.vodRepository.update(vodId, {
      events: deduped as unknown as Record<string, any>[],
      startTime: firstStart?.timestamp,
      endTime: lastEnd?.timestamp,
      status: VodStatus.PROCESSED,
    });

    // Nettoyer les chunks temporaires
    await db.vodChunkEvent.deleteMany({ where: { vodId } });

    this.logger.log(`✅ VOD ${vodId} analysée : ${gamesDetected} games, status PROCESSED`);
  }

  private deduplicateEvents(events: GameScreenEvent[], windowSeconds = 5): GameScreenEvent[] {
    // O(n): track last-seen timestamp per event type to avoid O(n²) result.some()
    const lastSeen = new Map<string, number>();
    const result: GameScreenEvent[] = [];
    for (const event of events) {
      const prev = lastSeen.get(event.type);
      if (prev === undefined || event.timestamp - prev > windowSeconds) {
        result.push(event);
        lastSeen.set(event.type, event.timestamp);
      }
    }
    return result;
  }

  private countGames(events: GameScreenEvent[]): number {
    let games = 0;
    let hasStart = false;
    for (const event of events) {
      if (event.type === 'START' && !hasStart) hasStart = true;
      else if (event.type === 'END' && hasStart) { games++; hasStart = false; }
    }
    return games;
  }
}
