import { Controller, Get, Post, Param, Inject } from '@nestjs/common';
import { ImportTournamentUseCase } from '../../application/use-cases/import-tournament.use-case';
import { ImportSetsUseCase } from '../../application/use-cases/import-sets.use-case';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';

@Controller('tournaments')
export class TournamentController {
  constructor(
    private readonly importTournamentUseCase: ImportTournamentUseCase,
    private readonly importSetsUseCase: ImportSetsUseCase,
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
  ) {}

  @Post('import/:slug')
  async import(@Param('slug') slug: string) {
    const tournament = await this.importTournamentUseCase.execute(slug);
    return {
      message: 'Tournament imported successfully',
      data: tournament,
    };
  }

  @Post('import-sets/:id')
  async importSets(@Param('id') id: string) {
    await this.importSetsUseCase.execute(id);
    return {
      message: 'Sets and players imported successfully',
    };
  }

  @Get(':startGGId/startgg-events')
  async getStartGGEvents(@Param('startGGId') startGGId: string) {
    return this.startGGService.getEventsByTournamentId(startGGId);
  }
}
