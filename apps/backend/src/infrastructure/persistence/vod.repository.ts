import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Vod, VodStatus } from '../../domain/entities/vod.entity';
import { IVodRepository } from '../../domain/repositories/vod.repository.interface';
import { VodMapper } from './mappers/vod.mapper';
import { VodStatus as PrismaVodStatus } from '@prisma/client';

@Injectable()
export class VodRepository implements IVodRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(vod: Omit<Vod, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vod> {
    const { setId, events, ...rest } = vod;
    const created = await this.prisma.vod.create({
      data: {
        ...rest,
        setId: setId ?? null,
        events: events ? (events as any) : undefined,
        status: vod.status as unknown as PrismaVodStatus,
      } as any,
    });
    return VodMapper.toDomain(created);
  }

  async findById(id: string): Promise<Vod | null> {
    const vod = await this.prisma.vod.findUnique({
      where: { id },
    });
    return vod ? VodMapper.toDomain(vod) : null;
  }

  async findBySetId(setId: string): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: { setId },
      orderBy: { createdAt: 'asc' },
    });
    return vods.map(VodMapper.toDomain);
  }

  async findByStatus(status: VodStatus): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: { status: status as unknown as PrismaVodStatus },
      orderBy: { createdAt: 'desc' },
    });
    return vods.map(VodMapper.toDomain);
  }

  async update(id: string, data: Partial<Vod>): Promise<Vod> {
    const updated = await this.prisma.vod.update({
      where: { id },
      data: {
        ...data,
        fileSize: data.fileSize != null ? BigInt(data.fileSize) : undefined,
        status: data.status ? (data.status as unknown as PrismaVodStatus) : undefined,
      },
    });
    return VodMapper.toDomain(updated);
  }

  async updateStatus(id: string, status: VodStatus): Promise<Vod> {
    const updated = await this.prisma.vod.update({
      where: { id },
      data: { status: status as unknown as PrismaVodStatus },
    });
    return VodMapper.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.vod.delete({
      where: { id },
    });
  }

  async findAll(): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return vods.map(VodMapper.toDomain);
  }

  async findPendingProcessing(): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: {
        status: {
          in: [PrismaVodStatus.DOWNLOADED, PrismaVodStatus.PROCESSING],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return vods.map(VodMapper.toDomain);
  }

  async findByTournamentId(tournamentId: string): Promise<Vod[]> {
    const vods = await this.prisma.vod.findMany({
      where: {
        OR: [
          { tournamentId },
          { set: { tournamentId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return vods.map(VodMapper.toDomain);
  }
}
