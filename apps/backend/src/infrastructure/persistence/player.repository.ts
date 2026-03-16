import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Player } from '../../domain/entities/player.entity';
import { IPlayerRepository } from '../../domain/repositories/player.repository.interface';
import { PlayerMapper } from './mappers/player.mapper';

@Injectable()
export class PlayerRepository implements IPlayerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(player: Omit<Player, 'id' | 'createdAt' | 'updatedAt'>): Promise<Player> {
    const created = await this.prisma.player.create({
      data: player,
    });
    return PlayerMapper.toDomain(created);
  }

  async findById(id: string): Promise<Player | null> {
    const player = await this.prisma.player.findUnique({
      where: { id },
    });
    return player ? PlayerMapper.toDomain(player) : null;
  }

  async findByStartGGId(startGGId: string): Promise<Player | null> {
    const player = await this.prisma.player.findUnique({
      where: { startGGId },
    });
    return player ? PlayerMapper.toDomain(player) : null;
  }

  async findByTag(tag: string): Promise<Player | null> {
    const player = await this.prisma.player.findFirst({
      where: { tag },
    });
    return player ? PlayerMapper.toDomain(player) : null;
  }

  async update(id: string, data: Partial<Player>): Promise<Player> {
    const updated = await this.prisma.player.update({
      where: { id },
      data,
    });
    return PlayerMapper.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.player.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Player[]> {
    const players = await this.prisma.player.findMany();
    return players.map(PlayerMapper.toDomain);
  }

  async findByName(name: string): Promise<Player[]> {
    const players = await this.prisma.player.findMany({
      where: { name: { contains: name, mode: 'insensitive' } },
    });
    return players.map(PlayerMapper.toDomain);
  }
}
