import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  GAME_SCREEN_DETECTOR_TOKEN,
  GameScreenEvent,
  IGameScreenDetector,
} from '../../domain/interfaces/game-screen-detector.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';

export interface AnalyzeVodResult {
  vodId: string;
  events: GameScreenEvent[];
  gamesDetected: number;
  duration: number; // en secondes
}

@Injectable()
export class AnalyzeVodUseCase {
  private readonly logger = new Logger(AnalyzeVodUseCase.name);

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(GAME_SCREEN_DETECTOR_TOKEN)
    private readonly gameScreenDetector: IGameScreenDetector
  ) {}

  async execute(vodId: string): Promise<AnalyzeVodResult> {
    const startTime = Date.now();
    
    this.logger.log(`🎬 Démarrage analyse VOD: ${vodId}`);

    // 1. Récupérer la VOD
    const vod = await this.vodRepository.findById(vodId);
    if (!vod) {
      throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    }

    if (!vod.filePath) {
      throw new NotFoundException(`VOD ${vodId} n'a pas de fichier local`);
    }

    this.logger.log(`📁 Fichier: ${vod.filePath}`);

    // 2. Détecter les événements via OCR
    const events = await this.gameScreenDetector.detectEvents(vod.filePath);

    // 3. Compter les games (pairs START/END)
    const gamesDetected = this.countGames(events);

    const duration = (Date.now() - startTime) / 1000;

    this.logger.log(
      `✅ Analyse terminée: ${events.length} événements, ${gamesDetected} games détectés en ${duration.toFixed(1)}s`
    );

    // 4. Persister startTime/endTime + tous les events
    const firstStart = events.find(e => e.type === 'START');
    const lastEnd = [...events].reverse().find(e => e.type === 'END');
    if (firstStart && lastEnd) {
      await this.vodRepository.update(vodId, {
        startTime: firstStart.timestamp,
        endTime: lastEnd.timestamp,
        events: events as unknown as Record<string, any>[],
      });
    }

    return {
      vodId,
      events,
      gamesDetected,
      duration,
    };
  }

  private countGames(events: GameScreenEvent[]): number {
    let games = 0;
    let hasStart = false;

    for (const event of events) {
      if (event.type === 'START' && !hasStart) {
        hasStart = true;
      } else if (event.type === 'END' && hasStart) {
        games++;
        hasStart = false;
      }
    }

    return games;
  }
}
