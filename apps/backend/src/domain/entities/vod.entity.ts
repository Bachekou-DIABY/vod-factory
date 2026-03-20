export enum VodStatus {
  PENDING = 'PENDING',
  DOWNLOADING = 'DOWNLOADING',
  DOWNLOADED = 'DOWNLOADED',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED'
}

export interface Vod {
  id: string;
  setId: string;
  tournamentId?: string; // ID du tournoi pour filtrage
  sourceUrl: string;
  filePath?: string; // Chemin local du fichier téléchargé
  processedUrl?: string;
  status: VodStatus;
  duration?: number;
  fileSize?: number;
  resolution?: string;
  fps?: number;
  startTime?: number;
  endTime?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
