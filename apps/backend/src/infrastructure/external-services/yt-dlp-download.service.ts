import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  IVodDownloadService,
  VOD_DOWNLOAD_SERVICE_TOKEN,
  DownloadProgress,
  DownloadResult,
} from '../../domain/interfaces/vod-download-service.interface';

@Injectable()
export class YtDlpDownloadService implements IVodDownloadService {
  private readonly logger = new Logger(YtDlpDownloadService.name);
  private readonly storageDir = path.join(process.cwd(), 'storage', 'vods');

  constructor() {
    // Créer le dossier de stockage si inexistant
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
      this.logger.log(`📁 Dossier créé: ${this.storageDir}`);
    }
  }

  async download(
    url: string,
    outputPath?: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    const filename = `vod_${Date.now()}_%(title)s.%(ext)s`;
    const output = outputPath || path.join(this.storageDir, filename);
    
    this.logger.log(`⬇️ Téléchargement: ${url}`);
    this.logger.log(`📂 Destination: ${output}`);

    return new Promise((resolve, reject) => {
      // yt-dlp args: format 720p pour analyse rapide, pas besoin de 4K
      const args = [
        url,
        '-f', 'best[height<=720]/best', // Max 720p pour performance
        '-o', output,
        '--progress',
        '--newline',
        '--no-warnings',
        '--no-call-home',
        '--ffmpeg-location', 'ffmpeg', // Utilise FFmpeg système
      ];

      const ytDlp = spawn('yt-dlp', args);
      
      let finalFilePath = '';
      let duration = 0;
      let resolution = '';
      let fps = 30;

      ytDlp.stdout.on('data', (data) => {
        const line = data.toString();
        
        // Parse progress
        if (line.includes('[download]') && onProgress) {
          const progress = this.parseProgress(line);
          if (progress) onProgress(progress);
        }
        
        // Parse destination finale
        if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
          const match = line.match(/Merging formats into "(.+)"/);
          if (match) finalFilePath = match[1];
        }
        
        this.logger.debug(line.trim());
      });

      ytDlp.stderr.on('data', (data) => {
        this.logger.warn(`yt-dlp: ${data.toString().trim()}`);
      });

      ytDlp.on('close', (code) => {
        if (code === 0) {
          // Récupérer le fichier téléchargé (yt-dlp remplace le template)
          const downloadedFile = this.findDownloadedFile(output);
          
          if (!downloadedFile) {
            reject(new Error('Fichier téléchargé non trouvé'));
            return;
          }

          const stats = fs.statSync(downloadedFile);
          
          // TODO: Extraire vraie durée/résolution avec ffprobe
          this.logger.log(`✅ Téléchargé: ${path.basename(downloadedFile)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
          
          resolve({
            filePath: downloadedFile,
            fileSize: stats.size,
            duration: 0, // Sera extrait avec ffprobe
            resolution: '720p',
            fps: 30,
          });
        } else {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
      });
    });
  }

  async getVideoInfo(url: string): Promise<{ title: string; duration: number; uploader: string }> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        url,
        '--print', '%(title)s',
        '--print', '%(duration)s',
        '--print', '%(uploader)s',
        '--no-warnings',
      ]);

      let output = '';
      
      ytDlp.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytDlp.on('close', (code) => {
        if (code === 0) {
          const [title, duration, uploader] = output.trim().split('\n');
          resolve({
            title: title || 'Unknown',
            duration: parseInt(duration) || 0,
            uploader: uploader || 'Unknown',
          });
        } else {
          reject(new Error('Failed to get video info'));
        }
      });
    });
  }

  private parseProgress(line: string): DownloadProgress | null {
    // Parse: [download]  12.3% of ~1.2GiB at 5.2MiB/s ETA 02:15
    const match = line.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+(.+)/);
    if (match) {
      return {
        percent: parseFloat(match[1]),
        downloadedSize: match[2],
        speed: match[3],
        eta: match[4],
      };
    }
    return null;
  }

  private findDownloadedFile(outputTemplate: string): string | null {
    const dir = path.dirname(outputTemplate);
    const files = fs.readdirSync(dir);
    
    // Cherche le fichier le plus récent qui correspond au pattern
    const vodFiles = files
      .filter(f => f.startsWith('vod_'))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        time: fs.statSync(path.join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    return vodFiles[0]?.path || null;
  }
}
