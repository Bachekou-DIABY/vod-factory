import { Controller, Get, Inject, Param } from '@nestjs/common';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';

@Controller('tournaments')
export class TournamentVodsController {
  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
  ) {}

  @Get(':id/vods')
  async getVodsByTournamentId(@Param('id') tournamentId: string) {
    const vods = await this.vodRepository.findByTournamentId(tournamentId);
    return vods.map((v) => ({
      id: v.id,
      sourceUrl: v.sourceUrl,
      filePath: v.filePath,
      status: v.status,
      eventStartGGId: v.eventStartGGId,
      streamName: v.streamName,
      createdAt: v.createdAt,
    }));
  }
}
