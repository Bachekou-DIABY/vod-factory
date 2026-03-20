import { Tournament } from '../entities/tournament.entity';

export interface StartGGSetResponse {
  id: string;
  roundName: string;
  totalGames?: number;
  streamName?: string;
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
  getTournamentBySlug(slug: string): Promise<Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'> | null>;
  getSetsByTournamentId(tournamentId: string): Promise<StartGGSetResponse[]>;
  /**
   * Récupère tous les sets streamés d'un event Start.gg, ordonnés par startedAt.
   * Filtre optionnellement par streamName (nom du channel Twitch).
   */
  getStreamSetsByEventId(eventStartGGId: string, streamName?: string): Promise<StartGGSetResponse[]>;
}

export const STARTGG_SERVICE_TOKEN = 'IStartGGService';
