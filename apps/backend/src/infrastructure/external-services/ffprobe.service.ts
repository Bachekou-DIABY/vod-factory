import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';

export interface ProbeResult {
  duration: number;
  resolution: string;
  fps: number;
}

@Injectable()
export class FfprobeService {
  private readonly logger = new Logger(FfprobeService.name);

  probe(filePath: string): Promise<ProbeResult> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          this.logger.warn(`ffprobe failed for ${filePath}: ${err.message}`);
          resolve({ duration: 0, resolution: '1920x1080', fps: 30 });
          return;
        }
        const video = metadata.streams.find(s => s.codec_type === 'video');
        const duration = Math.round(metadata.format.duration || 0);
        const resolution = video ? `${video.width}x${video.height}` : '1920x1080';
        const fps = video?.r_frame_rate ? this.parseFps(video.r_frame_rate) : 30;
        resolve({ duration, resolution, fps });
      });
    });
  }

  private parseFps(r: string): number {
    const [num, den] = r.split('/').map(Number);
    return den && den > 0 ? Math.round(num / den) : num || 30;
  }
}
