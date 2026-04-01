import { Tournament } from '../entities/tournament.entity';

export interface StartGGSetResponse {
  id: string;
  roundName: string;
  phaseName?: string;
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

export interface StartGGEventResponse {
  id: string;
  name: string;
}

export interface StartGGTournamentSearchResult {
  id: string;
  name: string;
  slug: string;
  startAt?: number; // Unix timestamp
}

export interface IStartGGService {
  getTournamentBySlug(slug: string): Promise<Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'> | null>;
  searchTournaments(query: string): Promise<StartGGTournamentSearchResult[]>;
  getSetsByTournamentId(tournamentId: string): Promise<StartGGSetResponse[]>;
  getEventsByTournamentId(startGGTournamentId: string): Promise<StartGGEventResponse[]>;
  /**
   * Récupère tous les sets streamés d'un event Start.gg, ordonnés par startedAt.
   * Filtre optionnellement par streamName (nom du channel Twitch).
   */
  getStreamSetsByEventId(eventStartGGId: string, streamName?: string): Promise<StartGGSetResponse[]>;
  /** Récupère TOUS les sets d'un event (streamés ou non), ordonnés par startedAt. */
  getAllSetsByEventId(eventStartGGId: string, streamName?: string): Promise<StartGGSetResponse[]>;
}

export const STARTGG_SERVICE_TOKEN = 'IStartGGService';
