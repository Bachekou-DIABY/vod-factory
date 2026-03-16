import { Player as PrismaPlayer } from '@prisma/client';
import { Player } from '../../../domain/entities/player.entity';

export class PlayerMapper {
  static toDomain(prismaPlayer: PrismaPlayer): Player {
    return {
      id: prismaPlayer.id,
      name: prismaPlayer.name,
      tag: prismaPlayer.tag ?? undefined,
      startGGId: prismaPlayer.startGGId ?? undefined,
      country: prismaPlayer.country ?? undefined,
      region: prismaPlayer.region ?? undefined,
      createdAt: prismaPlayer.createdAt,
      updatedAt: prismaPlayer.updatedAt,
    };
  }
}
