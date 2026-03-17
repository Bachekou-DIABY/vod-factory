import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import YTDlpWrap from 'yt-dlp-wrap';
import * as path from 'path';
import * as fs from 'fs';

export interface VideoMetadata {
  sourceUrl: string;
  duration: number; // en secondes
  title: string;
  thumbnail?: string;
  resolution?: string;
  fps?: number;
}

@Injectable()
export class VideoInfoService implements OnModuleInit {
  private readonly logger = new Logger(VideoInfoService.name);
  private ytDlp: YTDlpWrap;
  private readonly binPath = path.join(process.cwd(), 'bin', 'yt-dlp.exe');

  constructor() {
    this.ytDlp = new YTDlpWrap();
  }

  async onModuleInit() {
    await this.ensureBinaryExits();
  }

  private async ensureBinaryExits() {
    const binDir = path.dirname(this.binPath);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    if (!fs.existsSync(this.binPath)) {
      this.logger.log(`yt-dlp binary not found. Downloading to ${this.binPath}...`);
      try {
        await YTDlpWrap.downloadFromGithub(this.binPath);
        this.logger.log('yt-dlp binary downloaded successfully!');
      } catch (error) {
        this.logger.error(`Failed to download yt-dlp binary: ${error.message}`);
        // fallback to system yt-dlp if it exists
      }
    }
    
    if (fs.existsSync(this.binPath)) {
      this.ytDlp = new YTDlpWrap(this.binPath);
    }
  }

  async getMetadata(url: string): Promise<VideoMetadata> {
    try {
      this.logger.log(`Fetching metadata for URL: ${url}`);
      const metadata = await this.ytDlp.getVideoInfo(url);

      return {
        sourceUrl: url,
        duration: metadata.duration || 0,
        title: metadata.title || 'Unknown Title',
        thumbnail: metadata.thumbnail,
        resolution: metadata.resolution,
        fps: metadata.fps,
      };
    } catch (error) {
      this.logger.error(`Error fetching video metadata: ${error.message}`);
      throw new Error(`Failed to fetch video metadata: ${error.message}`);
    }
  }

  isValidUrl(url: string): boolean {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    const twitchRegex = /^(https?:\/\/)?(www\.)?(twitch\.tv)\/videos\/\d+$/;
    const twitchLiveRegex = /^(https?:\/\/)?(www\.)?(twitch\.tv)\/.+$/;
    return youtubeRegex.test(url) || twitchRegex.test(url) || twitchLiveRegex.test(url);
  }
}
