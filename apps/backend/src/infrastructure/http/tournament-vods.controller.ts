import { Controller, Get, Inject, Param } from '@nestjs/common';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { AlignmentReport } from '../../domain/alignment/alignment.types';
import { chapitresYoutube } from '../../application/alignment/chapters';

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

  /**
   * Clips approuvés, chacun avec ses chapitres YouTube s'ils sont possibles.
   *
   * Les chapitres se calculent à la volée depuis le rapport d'alignement :
   * une recoupe déplace les bornes du clip, pas les games dans la VOD.
   */
  @Get(':id/approved-clips')
  async getApprovedClips(@Param('id') tournamentId: string) {
    const vods = await this.vodRepository.findByTournamentId(tournamentId);
    const clipArrays = await Promise.all(
      vods.map(async (v) => {
        const rapport = v.alignment as AlignmentReport | undefined;
        const clips = await this.clipRepository.findByVodId(v.id);
        return clips.map((c) => {
          const set = rapport?.aligned?.find(
            (a) => c.setStartGGId && a.set.setStartGGId === c.setStartGGId,
          );
          return {
            ...c,
            chapitres: set ? chapitresYoutube(c, set.games) : null,
          };
        });
      }),
    );
    return clipArrays
      .flat()
      .filter((c) => c.status === 'APPROVED')
      .sort((a, b) => a.setOrder - b.setOrder);
  }
}
