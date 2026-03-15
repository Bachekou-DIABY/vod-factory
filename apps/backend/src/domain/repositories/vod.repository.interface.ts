import { Vod, VodStatus } from '../entities/vod.entity';

export interface IVodRepository {
  create(vod: Omit<Vod, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vod>;
  findById(id: string): Promise<Vod | null>;
  findBySetId(setId: string): Promise<Vod[]>;
  findByStatus(status: VodStatus): Promise<Vod[]>;
  update(id: string, data: Partial<Vod>): Promise<Vod>;
  updateStatus(id: string, status: VodStatus): Promise<Vod>;
  delete(id: string): Promise<void>;
  findAll(): Promise<Vod[]>;
  findPendingProcessing(): Promise<Vod[]>;
}
