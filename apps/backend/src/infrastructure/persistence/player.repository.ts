import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Player } from '../../domain/entities/player.entity';
import { IPlayerRepository } from '../../domain/repositories/player.repository.interface';

@Injectable()
export class PlayerRepository implements IPlayerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(player: Omit<Player, 'id' | 'createdAt' | 'updatedAt'>): Promise<Player> {
    const created = await this.prisma.player.create({
      data: player,
    });
    return created as Player;
  }

  async findById(id: string): Promise<Player | null> {
    const player = await this.prisma.player.findUnique({
      where: { id },
    });
    return player as Player | null;
  }

  async findByStartGGId(startGGId: string): Promise<Player | null> {
    const player = await this.prisma.player.findUnique({
      where: { startGGId },
    });
    return player as Player | null;
  }

  async findByTag(tag: string): Promise<Player | null> {
    const player = await this.prisma.player.findFirst({
      where: { tag },
    });
    return player as Player | null;
  }

  async update(id: string, data: Partial<Player>): Promise<Player> {
    const updated = await this.prisma.player.update({
      where: { id },
      data,
    });
    return updated as Player;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.player.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Player[]> {
    const players = await this.prisma.player.findMany();
    return players as Player[];
  }

  async findByName(name: string): Promise<Player[]> {
    const players = await this.prisma.player.findMany({
      where: { name: { contains: name, mode: 'insensitive' } },
    });
    return players as Player[];
  }
}
