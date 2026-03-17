import { Vod } from '../entities/vod.entity';

export interface IVodRepository {
  create(vod: Omit<Vod, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vod>;
  findById(id: string): Promise<Vod | null>;
  findBySetId(setId: string): Promise<Vod[]>;
  findByTournamentId(tournamentId: string): Promise<Vod[]>; // Ajouté pour faciliter la gestion
  update(id: string, data: Partial<Vod>): Promise<Vod>;
  delete(id: string): Promise<void>;
  findAll(): Promise<Vod[]>;
}
