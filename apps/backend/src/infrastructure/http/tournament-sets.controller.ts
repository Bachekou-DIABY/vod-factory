import { Controller, Get, Param, Inject, Logger } from '@nestjs/common';
import { ISetRepository, SET_REPOSITORY_TOKEN } from '../../domain/repositories/set.repository.interface';

@Controller('tournaments')
export class TournamentSetsController {
  private readonly logger = new Logger(TournamentSetsController.name);

  constructor(
    @Inject(SET_REPOSITORY_TOKEN)
    private readonly setRepository: ISetRepository
  ) {}

  @Get(':id/sets')
  async getSetsByTournamentId(@Param('id') tournamentId: string) {
    this.logger.log(`🔍 Récupération sets du tournoi: ${tournamentId}`);
    return this.setRepository.findByTournamentId(tournamentId);
  }
}
