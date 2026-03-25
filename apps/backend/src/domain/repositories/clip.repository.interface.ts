import { Clip } from '../entities/clip.entity';

export const CLIP_REPOSITORY_TOKEN = 'CLIP_REPOSITORY_TOKEN';

export interface IClipRepository {
  create(clip: Omit<Clip, 'id' | 'createdAt' | 'updatedAt'>): Promise<Clip>;
  findById(id: string): Promise<Clip | null>;
  findByVodId(vodId: string): Promise<Clip[]>;
  update(id: string, data: Partial<Pick<Clip, 'startSeconds' | 'endSeconds' | 'title' | 'description' | 'roundName' | 'players' | 'score' | 'status' | 'filePath' | 'thumbnailPath' | 'youtubeVideoId' | 'privacyStatus'>>): Promise<Clip>;
  delete(id: string): Promise<void>;
}
