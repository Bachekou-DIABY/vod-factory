import { Tournament } from '../entities/tournament.entity';

export interface IStartGGService {
  /**
   * Récupère les informations d'un tournoi depuis Start.gg via son slug.
   * Retourne les données formatées selon notre entité Tournament (sans les IDs internes).
   */
  getTournamentBySlug(slug: string): Promise<Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'> | null>;

  /**
   * On pourra ajouter ici d'autres méthodes plus tard (récupérer les sets, les joueurs, etc.)
   */
}

export const STARTGG_SERVICE_TOKEN = 'IStartGGService';
