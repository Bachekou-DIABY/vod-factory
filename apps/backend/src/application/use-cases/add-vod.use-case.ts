import { Inject, Injectable, Logger } from '@nestjs/common';
import { REPOSITORY_TOKENS } from '../../domain/repositories/injection-tokens';
import { IVodRepository } from '../../domain/repositories/vod.repository.interface';
import { ISetRepository } from '../../domain/repositories/set.repository.interface';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';
import { VideoInfoService } from '../../infrastructure/external-services/video-info.service';
import { Vod, VodStatus } from '../../domain/entities/vod.entity';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../domain/queues/queue-tokens';

@Injectable()
export class AddVodUseCase {
  private readonly logger = new Logger(AddVodUseCase.name);

  constructor(
    @Inject(REPOSITORY_TOKENS.VOD)
    private readonly vodRepository: IVodRepository,
    
    @Inject(REPOSITORY_TOKENS.SET)
    private readonly setRepository: ISetRepository,

    @Inject(REPOSITORY_TOKENS.TOURNAMENT)
    private readonly tournamentRepository: ITournamentRepository,

    private readonly videoInfoService: VideoInfoService,

    @InjectQueue(QUEUE_NAMES.VIDEO_PROCESSING)
    private readonly videoQueue: Queue,
  ) {}

  async execute(tournamentId: string, url: string): Promise<Vod[]> {
    this.logger.log(`Adding VOD for tournament ${tournamentId}: ${url}`);

    if (!this.videoInfoService.isValidUrl(url)) {
      throw new Error('Invalid URL. Only YouTube and Twitch are supported.');
    }

    const tournament = await this.tournamentRepository.findById(tournamentId);
    if (!tournament) {
      throw new Error('Tournament not found');
    }

    const metadata = await this.videoInfoService.getMetadata(url);

    const sets = await this.setRepository.findByTournamentId(tournamentId);
    if (sets.length === 0) {
      this.logger.warn(`No sets found for tournament ${tournamentId}.`);
    }

    const createdVods: Vod[] = [];
    
    for (const set of sets) {
      const vod = await this.vodRepository.create({
        setId: set.id,
        sourceUrl: url,
        status: VodStatus.PENDING,
        duration: metadata.duration,
        metadata: {
          title: metadata.title,
          thumbnail: metadata.thumbnail,
          resolution: metadata.resolution,
          fps: metadata.fps,
        },
      });

      // Ajouter un job dans la file d'attente pour traiter cette VOD
      await this.videoQueue.add('process-video', {
        vodId: vod.id,
        sourceUrl: url,
        tournamentId: tournamentId,
        setId: set.id
      });

      createdVods.push(vod);
    }

    return createdVods;
  }
}
