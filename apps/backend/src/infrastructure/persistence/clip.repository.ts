import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Clip } from '../../domain/entities/clip.entity';
import { IClipRepository } from '../../domain/repositories/clip.repository.interface';

@Injectable()
export class ClipRepository implements IClipRepository {
  private get db(): any { return this.prisma; }

  constructor(private readonly prisma: PrismaService) {}

  async create(clip: Omit<Clip, 'id' | 'createdAt' | 'updatedAt'>): Promise<Clip> {
    const created = await this.db.clip.create({ data: clip });
    return this.toDomain(created);
  }

  async findByVodId(vodId: string): Promise<Clip[]> {
    const clips = await this.db.clip.findMany({
      where: { vodId },
      orderBy: { setOrder: 'asc' },
    });
    return clips.map(this.toDomain);
  }

  async delete(id: string): Promise<void> {
    await this.db.clip.delete({ where: { id } });
  }

  private toDomain(prismaClip: any): Clip {
    return {
      id: prismaClip.id,
      vodId: prismaClip.vodId,
      setOrder: prismaClip.setOrder,
      setStartGGId: prismaClip.setStartGGId ?? undefined,
      filePath: prismaClip.filePath,
      startSeconds: prismaClip.startSeconds,
      endSeconds: prismaClip.endSeconds,
      createdAt: prismaClip.createdAt,
      updatedAt: prismaClip.updatedAt,
    };
  }
}
