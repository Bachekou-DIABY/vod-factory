import { Set as PrismaSet } from '@prisma/client';
import { Set } from '../../../domain/entities/set.entity';

export class SetMapper {
  static toDomain(prismaSet: PrismaSet): Set {
    return {
      id: prismaSet.id,
      tournamentId: prismaSet.tournamentId,
      roundName: prismaSet.roundName ?? undefined,
      bestOf: prismaSet.bestOf,
      winnerId: prismaSet.winnerId ?? undefined,
      score: prismaSet.score ?? undefined,
      startGGId: prismaSet.startGGId ?? undefined,
      startTime: prismaSet.startTime ?? undefined,
      endTime: prismaSet.endTime ?? undefined,
      player1Id: prismaSet.player1Id,
      player2Id: prismaSet.player2Id,
      createdAt: prismaSet.createdAt,
      updatedAt: prismaSet.updatedAt,
    };
  }
}
