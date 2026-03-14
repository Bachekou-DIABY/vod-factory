export interface Player {
  id: string;
  name: string;
  tag?: string;
  startGGId?: string;
  country?: string;
  region?: string;
  createdAt: Date;
  updatedAt: Date;
}
