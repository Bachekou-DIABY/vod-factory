import { Controller, Post, Param } from '@nestjs/common';
import { ImportTournamentUseCase } from '../../application/use-cases/import-tournament.use-case';

@Controller('tournaments')
export class TournamentController {
  constructor(private readonly importTournamentUseCase: ImportTournamentUseCase) {}

  @Post('import/:slug')
  async import(@Param('slug') slug: string) {
    const tournament = await this.importTournamentUseCase.execute(slug);
    return {
      message: 'Tournament imported successfully',
      data: tournament,
    };
  }
}
