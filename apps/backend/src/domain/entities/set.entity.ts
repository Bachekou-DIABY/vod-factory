export interface Set {
  id: string;
  tournamentId: string;
  roundName?: string;
  bestOf: number;
  winnerId?: string;
  score?: string;
  startGGId?: string;
  startTime?: Date;
  endTime?: Date;
  createdAt: Date;
  updatedAt: Date;
}
