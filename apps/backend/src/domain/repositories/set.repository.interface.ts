import { Set } from '../entities/set.entity';

export const SET_REPOSITORY_TOKEN = Symbol('SET_REPOSITORY_TOKEN');

export interface ISetRepository {
  create(set: Omit<Set, 'id' | 'createdAt' | 'updatedAt'>): Promise<Set>;
  findById(id: string): Promise<Set | null>;
  findByStartGGId(startGGId: string): Promise<Set | null>;
  findByTournamentId(tournamentId: string): Promise<Set[]>;
  findByPlayerId(playerId: string): Promise<Set[]>;
  update(id: string, data: Partial<Set>): Promise<Set>;
  delete(id: string): Promise<void>;
  findAll(): Promise<Set[]>;
}
