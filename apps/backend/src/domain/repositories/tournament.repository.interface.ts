import { Tournament } from '../entities/tournament.entity';

export interface ITournamentRepository {
  create(tournament: Omit<Tournament, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tournament>;
  findById(id: string): Promise<Tournament | null>;
  findBySlug(slug: string): Promise<Tournament | null>;
  findByStartGGId(startGGId: string): Promise<Tournament | null>;
  update(id: string, data: Partial<Tournament>): Promise<Tournament>;
  delete(id: string): Promise<void>;
  findAll(): Promise<Tournament[]>;
}
