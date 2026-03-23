export type ClipStatus = 'PENDING' | 'APPROVED' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

export interface Clip {
  id: string;
  vodId: string;
  setOrder: number;
  setStartGGId?: string;
  filePath: string;
  startSeconds: number;
  endSeconds: number;
  title?: string;
  roundName?: string;
  players?: string;
  score?: string;
  status: ClipStatus;
  createdAt: Date;
  updatedAt: Date;
}
