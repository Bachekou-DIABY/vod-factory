import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Vod, VodStatus } from '../../domain/entities/vod.entity';
import { IVodRepository } from '../../domain/repositories/vod.repository.interface';

@Injectable()
export class VodRepository implements IVodRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(vod: Omit<Vod, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vod> {
    const created = await this.prisma.vod.create({
      data: vod,
    });
    return created as Vod;
  }

  async findById(id: string): Promise<Vod | null> {
    const vod = await this.prisma.vod.findUnique({
      where: { id },
      include: {
        set: {
          include: {
            tournament: true,
            player1: true,
            player2: true,
          },
        },
      },
    });
    return vod as Vod | null;
  }

  async findBySetId(setId: string): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: { setId },
      orderBy: { createdAt: 'asc' },
    });
    return vods as Vod[];
  }

  async findByStatus(status: VodStatus): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
    return vods as Vod[];
  }

  async update(id: string, data: Partial<Vod>): Promise<Vod> {
    const updated = await this.prisma.vod.update({
      where: { id },
      data,
    });
    return updated as Vod;
  }

  async updateStatus(id: string, status: VodStatus): Promise<Vod> {
    const updated = await this.prisma.vod.update({
      where: { id },
      data: { status },
    });
    return updated as Vod;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.vod.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      include: {
        set: {
          include: {
            tournament: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return vods as Vod[];
  }

  async findPendingProcessing(): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: {
        status: {
          in: [VodStatus.DOWNLOADED, VodStatus.PROCESSING],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return vods as Vod[];
  }
}
