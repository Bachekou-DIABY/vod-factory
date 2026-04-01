import { Injectable } from '@nestjs/common';

@Injectable()
export class DownloadProgressService {
  private readonly progress = new Map<string, number>();

  set(vodId: string, percent: number) {
    this.progress.set(vodId, percent);
  }

  get(vodId: string): number | null {
    const val = this.progress.get(vodId);
    return val !== undefined ? val : null;
  }

  clear(vodId: string) {
    this.progress.delete(vodId);
  }
}
