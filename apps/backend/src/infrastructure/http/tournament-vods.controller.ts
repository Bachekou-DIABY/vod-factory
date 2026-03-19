import { Controller, Get, Param, Logger } from '@nestjs/common';
import { GetTournamentVodsUseCase } from '../../application/use-cases/get-tournament-vods.usecase';

@Controller('tournaments')
export class TournamentVodsController {
  private readonly logger = new Logger(TournamentVodsController.name);

  constructor(
    private readonly getTournamentVodsUseCase: GetTournamentVodsUseCase,
  ) {}

  @Get(':id/vods')
  async getVodsByTournamentId(@Param('id') tournamentId: string) {
    this.logger.log(`🔍 Récupération VODs du tournoi ID: ${tournamentId}`);
    return this.getTournamentVodsUseCase.execute(tournamentId);
  }
}
