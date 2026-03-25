import { Vod as PrismaVod } from '@prisma/client';
import { Vod, VodStatus } from '../../../domain/entities/vod.entity';

export class VodMapper {
  static toDomain(prismaVod: PrismaVod): Vod {
    return {
      id: prismaVod.id,
      setId: prismaVod.setId ?? undefined,
      eventStartGGId: (prismaVod as any).eventStartGGId ?? undefined,
      streamName: (prismaVod as any).streamName ?? undefined,
      tournamentId: (prismaVod as any).tournamentId ?? undefined,
      name: (prismaVod as any).name ?? undefined,
      sourceUrl: prismaVod.sourceUrl,
      filePath: prismaVod.filePath ?? undefined,
      processedUrl: prismaVod.processedUrl ?? undefined,
      status: prismaVod.status as unknown as VodStatus,
      duration: prismaVod.duration ?? undefined,
      fileSize: prismaVod.fileSize != null ? Number(prismaVod.fileSize) : undefined,
      resolution: prismaVod.resolution ?? undefined,
      fps: prismaVod.fps ?? undefined,
      startTime: prismaVod.startTime ?? undefined,
      endTime: prismaVod.endTime ?? undefined,
      recordedAt: (prismaVod as any).recordedAt ?? undefined,
      events: ((prismaVod as any).events as Record<string, any>[]) ?? undefined,
      metadata: (prismaVod.metadata as unknown as Record<string, unknown>) ?? undefined,
      createdAt: prismaVod.createdAt,
      updatedAt: prismaVod.updatedAt,
    };
  }
}
