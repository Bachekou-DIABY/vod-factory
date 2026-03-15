import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Set } from '../../domain/entities/set.entity';
import { ISetRepository } from '../../domain/repositories/set.repository.interface';

@Injectable()
export class SetRepository implements ISetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(set: Omit<Set, 'id' | 'createdAt' | 'updatedAt'>): Promise<Set> {
    const created = await this.prisma.set.create({
      data: set,
    });
    return created as Set;
  }

  async findById(id: string): Promise<Set | null> {
    const set = await this.prisma.set.findUnique({
      where: { id },
      include: {
        tournament: true,
        player1: true,
        player2: true,
        vods: true,
      },
    });
    return set as Set | null;
  }

  async findByStartGGId(startGGId: string): Promise<Set | null> {
    const set = await this.prisma.set.findUnique({
      where: { startGGId },
      include: {
        tournament: true,
        player1: true,
        player2: true,
      },
    });
    return set as Set | null;
  }

  async findByTournamentId(tournamentId: string): Promise<Set[]> {
    const sets = await this.prisma.set.findMany({
      where: { tournamentId },
      include: {
        player1: true,
        player2: true,
        vods: true,
      },
      orderBy: { startTime: 'asc' },
    });
    return sets as Set[];
  }

  async findByPlayerId(playerId: string): Promise<Set[]> {
    const sets = await this.prisma.set.findMany({
      where: {
        OR: [{ player1Id: playerId }, { player2Id: playerId }],
      },
      include: {
        tournament: true,
        player1: true,
        player2: true,
      },
      orderBy: { startTime: 'desc' },
    });
    return sets as Set[];
  }

  async update(id: string, data: Partial<Set>): Promise<Set> {
    const updated = await this.prisma.set.update({
      where: { id },
      data,
    });
    return updated as Set;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.set.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Set[]> {
    const sets = await this.prisma.set.findMany({
      include: {
        tournament: true,
        player1: true,
        player2: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return sets as Set[];
  }
}
