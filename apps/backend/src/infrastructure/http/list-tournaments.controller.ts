import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { TournamentRepository } from '../../infrastructure/persistence/tournament.repository';

@Controller('tournaments')
export class ListTournamentsController {
  private readonly logger = new Logger(ListTournamentsController.name);

  constructor(
    @Inject('ITournamentRepository')
    private readonly tournamentRepository: TournamentRepository
  ) {}

  @Get()
  async listAll() {
    this.logger.log('📋 Listing all tournaments');
    const tournaments = await this.tournamentRepository.findAll();
    return tournaments.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      startAt: t.startAt,
    }));
  }
}
