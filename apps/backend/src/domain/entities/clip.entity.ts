export interface Clip {
  id: string;
  vodId: string;
  setOrder: number;
  setStartGGId?: string;
  filePath: string;
  startSeconds: number;
  endSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}
