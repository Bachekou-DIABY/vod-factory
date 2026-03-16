import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Set } from '../../domain/entities/set.entity';
import { ISetRepository } from '../../domain/repositories/set.repository.interface';
import { SetMapper } from './mappers/set.mapper';

@Injectable()
export class SetRepository implements ISetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(set: Omit<Set, 'id' | 'createdAt' | 'updatedAt'>): Promise<Set> {
    const created = await this.prisma.set.create({
      data: set,
    });
    return SetMapper.toDomain(created);
  }

  async findById(id: string): Promise<Set | null> {
    const set = await this.prisma.set.findUnique({
      where: { id },
    });
    return set ? SetMapper.toDomain(set) : null;
  }

  async findByStartGGId(startGGId: string): Promise<Set | null> {
    const set = await this.prisma.set.findUnique({
      where: { startGGId },
    });
    return set ? SetMapper.toDomain(set) : null;
  }

  async findByTournamentId(tournamentId: string): Promise<Set[]> {
    const sets = await this.prisma.set.findMany({
      where: { tournamentId },
      orderBy: { startTime: 'asc' },
    });
    return sets.map(SetMapper.toDomain);
  }

  async findByPlayerId(playerId: string): Promise<Set[]> {
    const sets = await this.prisma.set.findMany({
      where: {
        OR: [{ player1Id: playerId }, { player2Id: playerId }],
      },
      orderBy: { startTime: 'desc' },
    });
    return sets.map(SetMapper.toDomain);
  }

  async update(id: string, data: Partial<Set>): Promise<Set> {
    const updated = await this.prisma.set.update({
      where: { id },
      data,
    });
    return SetMapper.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.set.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Set[]> {
    const sets = await this.prisma.set.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return sets.map(SetMapper.toDomain);
  }
}
