export interface Set {
  id: string;
  tournamentId: string;
  roundName?: string;
  totalGames?: number;
  streamName?: string;
  winnerId?: string;
  score?: string;
  startGGId?: string;
  startTime?: Date;
  endTime?: Date;
  player1Id: string;
  player2Id: string;
  createdAt: Date;
  updatedAt: Date;
}
