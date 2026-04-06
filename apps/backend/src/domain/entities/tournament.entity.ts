export interface Tournament {
  id: string;
  name: string;
  slug: string;
  startAt: Date;
  endAt: Date;
  startGGId?: string;
  youtubePlaylistId?: string;
  youtubeAccountId?: string;
  archivedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
