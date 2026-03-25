import { Inject, Injectable, Logger } from '@nestjs/common';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';

export interface GetTournamentVodsResult {
  tournamentId: string;
  vods: Array<{
    id: string;
    setId: string;
    sourceUrl: string;
    status: string;
    streamName?: string;
    metadata?: Record<string, any>;
  }>;
}

@Injectable()
export class GetTournamentVodsUseCase {
  private readonly logger = new Logger(GetTournamentVodsUseCase.name);

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository
  ) {}

  async execute(tournamentId: string): Promise<GetTournamentVodsResult> {
    this.logger.log(`🔍 Récupération VODs du tournoi: ${tournamentId}`);

    const vods = await this.vodRepository.findByTournamentId(tournamentId);

    // Filtrer pour ne garder que les VODs des streams spécifiques
    const filteredVods = vods.map(vod => ({
      id: vod.id,
      setId: vod.setId,
      sourceUrl: vod.sourceUrl,
      status: vod.status,
      streamName: vod.metadata?.streamName,
      metadata: vod.metadata,
    }));

    this.logger.log(`✅ ${filteredVods.length} VODs trouvées pour le tournoi ${tournamentId}`);

    return {
      tournamentId,
      vods: filteredVods,
    };
  }
}
