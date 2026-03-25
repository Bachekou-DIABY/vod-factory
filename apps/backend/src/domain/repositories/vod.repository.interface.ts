import { Vod, VodStatus } from '../entities/vod.entity';

export const VOD_REPOSITORY_TOKEN = Symbol('VOD_REPOSITORY_TOKEN');

export interface IVodRepository {
  create(vod: Omit<Vod, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vod>;
  findById(id: string): Promise<Vod | null>;
  findBySetId(setId: string): Promise<Vod[]>;
  findByTournamentId(tournamentId: string): Promise<Vod[]>;
  findByStatus(status: VodStatus): Promise<Vod[]>;
  update(id: string, data: Partial<Vod>): Promise<Vod>;
  updateStatus(id: string, status: VodStatus): Promise<Vod>;
  delete(id: string): Promise<void>;
  findAll(): Promise<Vod[]>;
  findPendingProcessing(): Promise<Vod[]>;
}
