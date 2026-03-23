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

  async findById(id: string): Promise<Clip | null> {
    const clip = await this.db.clip.findUnique({ where: { id } });
    return clip ? this.toDomain(clip) : null;
  }

  async update(
    id: string,
    data: Partial<Pick<Clip, 'startSeconds' | 'endSeconds' | 'title' | 'roundName' | 'players' | 'score' | 'status' | 'filePath'>>,
  ): Promise<Clip> {
    const updated = await this.db.clip.update({ where: { id }, data });
    return this.toDomain(updated);
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
      title: prismaClip.title ?? undefined,
      roundName: prismaClip.roundName ?? undefined,
      players: prismaClip.players ?? undefined,
      score: prismaClip.score ?? undefined,
      status: prismaClip.status,
      createdAt: prismaClip.createdAt,
      updatedAt: prismaClip.updatedAt,
    };
  }
}
