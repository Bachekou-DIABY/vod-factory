import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Tournament } from '../../domain/entities/tournament.entity';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';
import { TournamentMapper } from './mappers/tournament.mapper';

@Injectable()
export class TournamentRepository implements ITournamentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(tournament: Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tournament> {
    const created = await this.prisma.tournament.create({
      data: tournament,
    });
    return TournamentMapper.toDomain(created);
  }

  async findById(id: string): Promise<Tournament | null> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
    });
    return tournament ? TournamentMapper.toDomain(tournament) : null;
  }

  async findBySlug(slug: string): Promise<Tournament | null> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { slug },
    });
    return tournament ? TournamentMapper.toDomain(tournament) : null;
  }

  async findByStartGGId(startGGId: string): Promise<Tournament | null> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { startGGId },
    });
    return tournament ? TournamentMapper.toDomain(tournament) : null;
  }

  async update(id: string, data: Partial<Tournament>): Promise<Tournament> {
    const updated = await this.prisma.tournament.update({
      where: { id },
      data,
    });
    return TournamentMapper.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tournament.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Tournament[]> {
    const tournaments = await this.prisma.tournament.findMany();
    return tournaments.map(TournamentMapper.toDomain);
  }
}
