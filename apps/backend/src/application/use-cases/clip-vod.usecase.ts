import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { GameScreenEvent } from '../../domain/interfaces/game-screen-detector.interface';

export interface ClipResult {
  setOrder: number;
  setStartGGId?: string;
  clipPath: string;
  startSeconds: number;
  endSeconds: number;
  fileSize: number;
}

export interface ClipVodResult {
  vodId: string;
  clips: ClipResult[];
}

@Injectable()
export class ClipVodUseCase {
  private readonly logger = new Logger(ClipVodUseCase.name);
  private readonly bufferSeconds = 15;

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(VOD_CLIPPER_TOKEN)
    private readonly clipper: IVodClipper,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
  ) {}

  async execute(vodId: string): Promise<ClipVodResult> {
    const vod = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.filePath) throw new NotFoundException(`VOD ${vodId} n'a pas de fichier local`);
    if (!vod.events?.length) {
      throw new Error(`VOD ${vodId} n'a pas encore été analysée (events manquants)`);
    }

    const clipsDir = path.join(process.cwd(), 'storage', 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });

    const events = vod.events as unknown as GameScreenEvent[];
    const gamePairs = this.buildGamePairs(events);

    this.logger.log(`🎮 ${gamePairs.length} games détectés pour VOD ${vodId}`);

    // Cas multi-sets via Start.gg
    if (vod.eventStartGGId) {
      return this.clipByStartGGSets(vod, gamePairs, clipsDir);
    }

    // Cas simple : 1 clip pour toute la VOD
    return this.clipSingleVod(vod, gamePairs, clipsDir);
  }

  private async clipByStartGGSets(
    vod: any,
    gamePairs: { start: number; end: number }[],
    clipsDir: string,
  ): Promise<ClipVodResult> {
    const sets = await this.startGGService.getStreamSetsByEventId(
      vod.eventStartGGId,
      vod.streamName,
    );

    this.logger.log(`📋 ${sets.length} sets trouvés sur Start.gg pour l'event ${vod.eventStartGGId}`);

    const clips: ClipResult[] = [];
    let gameIndex = 0;

    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      const gameCount = set.totalGames ?? this.parseScoreTotal(set.score);

      if (gameCount <= 0) {
        this.logger.warn(`Set ${set.id} (${set.roundName}): totalGames invalide (${gameCount}), skip`);
        continue;
      }

      const setGames = gamePairs.slice(gameIndex, gameIndex + gameCount);
      if (setGames.length === 0) {
        this.logger.warn(`Plus de games disponibles pour le set ${i + 1}, arrêt`);
        break;
      }

      gameIndex += gameCount;

      const startSeconds = Math.max(0, setGames[0].start - this.bufferSeconds);
      const endSeconds = setGames[setGames.length - 1].end + this.bufferSeconds;
      const outputPath = path.join(clipsDir, `${vod.id}_set_${i + 1}.mp4`);

      this.logger.log(`✂️ Set ${i + 1} (${set.roundName}): [${startSeconds}s → ${endSeconds}s] (${setGames.length} games)`);

      const result = await this.clipper.clip({
        inputPath: vod.filePath,
        outputPath,
        startSeconds,
        endSeconds,
      });

      await this.clipRepository.create({
        vodId: vod.id,
        setOrder: i + 1,
        setStartGGId: set.id,
        filePath: result.outputPath,
        startSeconds,
        endSeconds,
      });

      clips.push({
        setOrder: i + 1,
        setStartGGId: set.id,
        clipPath: result.outputPath,
        startSeconds,
        endSeconds,
        fileSize: result.fileSize,
      });
    }

    await this.vodRepository.update(vod.id, { status: VodStatus.COMPLETED });
    this.logger.log(`✅ ${clips.length} clips générés pour VOD ${vod.id}`);

    return { vodId: vod.id, clips };
  }

  private async clipSingleVod(
    vod: any,
    gamePairs: { start: number; end: number }[],
    clipsDir: string,
  ): Promise<ClipVodResult> {
    if (vod.startTime == null || vod.endTime == null) {
      throw new Error(`VOD ${vod.id} n'a pas encore été analysée (startTime/endTime manquants)`);
    }

    const startSeconds = Math.max(0, vod.startTime - this.bufferSeconds);
    const endSeconds = vod.endTime + this.bufferSeconds;
    const outputPath = path.join(clipsDir, `${vod.id}.mp4`);

    this.logger.log(`✂️ VOD ${vod.id}: clip unique [${startSeconds}s → ${endSeconds}s]`);

    const result = await this.clipper.clip({
      inputPath: vod.filePath,
      outputPath,
      startSeconds,
      endSeconds,
    });

    await this.clipRepository.create({
      vodId: vod.id,
      setOrder: 1,
      filePath: result.outputPath,
      startSeconds,
      endSeconds,
    });

    await this.vodRepository.update(vod.id, {
      processedUrl: result.outputPath,
      status: VodStatus.COMPLETED,
    });

    return {
      vodId: vod.id,
      clips: [{ setOrder: 1, clipPath: result.outputPath, startSeconds, endSeconds, fileSize: result.fileSize }],
    };
  }

  private buildGamePairs(events: GameScreenEvent[]): { start: number; end: number }[] {
    const pairs: { start: number; end: number }[] = [];
    let currentStart: number | null = null;

    for (const event of events) {
      if (event.type === 'START' && currentStart === null) {
        currentStart = event.timestamp;
      } else if (event.type === 'END' && currentStart !== null) {
        pairs.push({ start: currentStart, end: event.timestamp });
        currentStart = null;
      }
    }

    return pairs;
  }

  private parseScoreTotal(score: string): number {
    const numbers = score.match(/\d+/g)?.map(Number) ?? [];
    if (numbers.length >= 2) {
      return numbers[numbers.length - 2] + numbers[numbers.length - 1];
    }
    return 0;
  }
}
