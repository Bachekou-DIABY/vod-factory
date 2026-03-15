import { Player } from '../entities/player.entity';

export interface IPlayerRepository {
  create(player: Omit<Player, 'id' | 'createdAt' | 'updatedAt'>): Promise<Player>;
  findById(id: string): Promise<Player | null>;
  findByStartGGId(startGGId: string): Promise<Player | null>;
  findByTag(tag: string): Promise<Player | null>;
  update(id: string, data: Partial<Player>): Promise<Player>;
  delete(id: string): Promise<void>;
  findAll(): Promise<Player[]>;
  findByName(name: string): Promise<Player[]>;
}
