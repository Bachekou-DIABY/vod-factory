import { Controller, Get, Inject, Param } from '@nestjs/common';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';

@Controller('tournaments')
export class TournamentVodsController {
  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
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
      name: (v as any).name ?? undefined,
      createdAt: v.createdAt,
    }));
  }

  @Get(':id/approved-clips')
  async getApprovedClips(@Param('id') tournamentId: string) {
    const vods = await this.vodRepository.findByTournamentId(tournamentId);
    const clipArrays = await Promise.all(
      vods.map((v) => this.clipRepository.findByVodId(v.id)),
    );
    return clipArrays
      .flat()
      .filter((c) => c.status === 'APPROVED')
      .sort((a, b) => a.setOrder - b.setOrder);
  }
}
