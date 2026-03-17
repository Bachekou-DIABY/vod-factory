import { Controller, Post, Body, Param } from '@nestjs/common';
import { AddVodUseCase } from '../../application/use-cases/add-vod.use-case';

@Controller('vods')
export class VodController {
  constructor(private readonly addVodUseCase: AddVodUseCase) {}

  @Post('add/:tournamentId')
  async addVod(
    @Param('tournamentId') tournamentId: string,
    @Body('url') url: string
  ) {
    const vods = await this.addVodUseCase.execute(tournamentId, url);
    return {
      message: `${vods.length} VOD entries created and queued for processing.`,
      count: vods.length
    };
  }
}
