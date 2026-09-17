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
  setId?: string;
  eventStartGGId?: string;
  streamName?: string;
  tournamentId?: string;
  name?: string;
  sourceUrl: string;
  filePath?: string;
  processedUrl?: string;
  status: VodStatus;
  duration?: number;
  fileSize?: number;
  resolution?: string;
  fps?: number;
  startTime?: number;
  endTime?: number;
  recordedAt?: Date;
  events?: Record<string, any>[];
  /** Rapport d'alignement sets Start.gg ↔ games détectées (AlignmentReport). */
  alignment?: Record<string, any>;
  /** Signal HUD quantifié, pour rejouer la segmentation sans redécoder la VOD. */
  hudSignal?: Buffer;
  /** Échantillons par seconde du signal stocké. */
  signalSampleRate?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
