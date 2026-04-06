import { Controller, Get, Patch, Inject, Logger, Param, NotFoundException } from '@nestjs/common';
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
    return tournaments
      .filter(t => !t.archivedAt)
      .map(t => ({ id: t.id, name: t.name, slug: t.slug, startAt: t.startAt }));
  }

  @Get('archived')
  async listArchived() {
    const tournaments = await this.tournamentRepository.findAll();
    return tournaments
      .filter(t => !!t.archivedAt)
      .map(t => ({ id: t.id, name: t.name, slug: t.slug, startAt: t.startAt, archivedAt: t.archivedAt }));
  }

  @Get(':slug')
  async findBySlug(@Param('slug') slug: string) {
    this.logger.log(`🔍 Get tournament by slug: ${slug}`);
    const tournament = await this.tournamentRepository.findBySlug(slug);
    if (!tournament) throw new NotFoundException(`Tournament "${slug}" not found`);
    return tournament;
  }

  @Patch(':id/archive')
  async archive(@Param('id') id: string) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundException(`Tournament ${id} not found`);
    await this.tournamentRepository.update(id, { archivedAt: new Date() });
    return { message: 'Tournoi archivé' };
  }

  @Patch(':id/unarchive')
  async unarchive(@Param('id') id: string) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundException(`Tournament ${id} not found`);
    await this.tournamentRepository.update(id, { archivedAt: undefined });
    return { message: 'Tournoi désarchivé' };
  }
}
