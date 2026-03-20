import { Vod as PrismaVod } from '@prisma/client';
import { Vod, VodStatus } from '../../../domain/entities/vod.entity';

export class VodMapper {
  static toDomain(prismaVod: PrismaVod): Vod {
    return {
      id: prismaVod.id,
      setId: prismaVod.setId,
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
      metadata: (prismaVod.metadata as unknown as Record<string, unknown>) ?? undefined,
      createdAt: prismaVod.createdAt,
      updatedAt: prismaVod.updatedAt,
    };
  }
}
