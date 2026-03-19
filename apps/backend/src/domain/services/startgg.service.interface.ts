import { Tournament } from '../entities/tournament.entity';

export interface StartGGSetResponse {
  id: string;
  roundName: string;
  bestOf: number;
  winnerId: string;
  score: string;
  startTime?: string;  // ISO datetime
  endTime?: string;    // ISO datetime
  stream?: {
    streamName: string;
    streamId: string;
  };
  player1: {
    id: string;
    name: string;
    tag?: string;
  };
  player2: {
    id: string;
    name: string;
    tag?: string;
  };
}

export interface IStartGGService {
  /**
   * Récupère les informations d'un tournoi depuis Start.gg via son slug.
   * Retourne les données formatées selon notre entité Tournament (sans les IDs internes).
   */
  getTournamentBySlug(slug: string): Promise<Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'> | null>;

  /**
   * Récupère la liste des matchs (sets) d'un tournoi depuis Start.gg via son ID.
   * Retourne une liste d'objets contenant les données du set et des joueurs.
   */
  getSetsByTournamentId(tournamentId: string): Promise<StartGGSetResponse[]>;
}

export const STARTGG_SERVICE_TOKEN = 'IStartGGService';
