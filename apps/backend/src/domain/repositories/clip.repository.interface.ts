import { Clip } from '../entities/clip.entity';

export const CLIP_REPOSITORY_TOKEN = 'CLIP_REPOSITORY_TOKEN';

export interface IClipRepository {
  create(clip: Omit<Clip, 'id' | 'createdAt' | 'updatedAt'>): Promise<Clip>;
  findByVodId(vodId: string): Promise<Clip[]>;
  delete(id: string): Promise<void>;
}
