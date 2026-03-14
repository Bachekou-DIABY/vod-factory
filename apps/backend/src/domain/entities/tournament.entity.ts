export interface Tournament {
  id: string;
  name: string;
  slug: string;
  startAt: Date;
  endAt: Date;
  startGGId?: string;
  createdAt: Date;
  updatedAt: Date;
}
