import { Tournament as PrismaTournament } from '@prisma/client';
import { Tournament } from '../../../domain/entities/tournament.entity';

export class TournamentMapper {
  /**
   * Transforme un objet provenant de la base de données (Prisma)
   * vers notre entité du domaine.
   */
  static toDomain(prismaTournament: PrismaTournament): Tournament {
    return {
      id: prismaTournament.id,
      name: prismaTournament.name,
      slug: prismaTournament.slug,
      startAt: prismaTournament.startAt,
      endAt: prismaTournament.endAt,
      startGGId: prismaTournament.startGGId,
      youtubePlaylistId: prismaTournament.youtubePlaylistId ?? undefined,
      createdAt: prismaTournament.createdAt,
      updatedAt: prismaTournament.updatedAt,
    };
  }

  /**
   * Optionnel : si on avait besoin de transformer dans l'autre sens
   * (Domain -> Prisma) pour des cas complexes.
   */
}
