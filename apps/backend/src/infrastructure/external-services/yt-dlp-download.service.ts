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
      const args = [
        url,
        '-f', 'bestvideo[height>=360][vcodec!=none]+bestaudio/best[height>=360][vcodec!=none]/best[vcodec!=none]',
        '-o', output,
        '--no-playlist',
        '--progress',
        '--newline',
        '--no-warnings',
        '--no-call-home',
        '--ffmpeg-location', 'ffmpeg',
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
      ];

      const ytDlp = spawn(process.env.YT_DLP_PATH || 'yt-dlp', args);

      ytDlp.on('error', (err) => {
        reject(new Error(`yt-dlp introuvable ou non exécutable: ${err.message}. Vérifiez l'installation de yt-dlp dans le container.`));
      });

      const handleChunk = (buf: string, data: Buffer, src: string): string => {
        buf += data.toString();
        // Split on both \n and \r (yt-dlp uses \r for in-place progress, \n with --newline)
        const lines = buf.split(/[\r\n]/);
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this.logger.log(`yt-dlp ${src}: ${trimmed}`);
          if (trimmed.includes('[download]') && onProgress) {
            const progress = this.parseProgress(trimmed);
            if (progress) onProgress(progress);
          }
        }
        return buf;
      };

      let stdoutBuf = '';
      ytDlp.stdout.on('data', (data) => { stdoutBuf = handleChunk(stdoutBuf, data, 'stdout'); });

      let stderrBuf = '';
      ytDlp.stderr.on('data', (data) => { stderrBuf = handleChunk(stderrBuf, data, 'stderr'); });

      ytDlp.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp exited with code ${code}`));
          return;
        }

        try {
          // Cherche un fichier mergé (sans format ID)
          let downloadedFile = this.findDownloadedFile(output);

          // Si pas de fichier mergé, merger manuellement video + audio
          if (!downloadedFile) {
            this.logger.warn('⚠️ Pas de fichier mergé trouvé, tentative de merge manuel...');
            downloadedFile = await this.mergeStreams(output);
          }

          if (!downloadedFile) {
            reject(new Error('Fichier téléchargé non trouvé'));
            return;
          }

          const stats = fs.statSync(downloadedFile);
          this.logger.log(`✅ Téléchargé: ${path.basename(downloadedFile)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

          // Extract stream start timestamp from yt-dlp metadata
          let recordedAt: Date | undefined;
          try {
            const info = await this.getVideoInfo(url);
            if (info.timestamp) {
              recordedAt = new Date(info.timestamp * 1000);
              this.logger.log(`📅 recordedAt: ${recordedAt.toISOString()}`);
            }
          } catch {
            this.logger.warn(`⚠️ Impossible d'extraire le timestamp pour ${url}`);
          }

          resolve({
            filePath: downloadedFile,
            fileSize: stats.size,
            duration: 0,
            resolution: '1080p',
            fps: 30,
            recordedAt,
          });
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async getVideoInfo(url: string): Promise<{ title: string; duration: number; uploader: string; timestamp?: number }> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn(process.env.YT_DLP_PATH || 'yt-dlp', [
        url,
        '--print', '%(title)s',
        '--print', '%(duration)s',
        '--print', '%(uploader)s',
        '--print', '%(timestamp)s',
        '--no-warnings',
      ]);

      let output = '';

      ytDlp.on('error', (err) => reject(new Error(`yt-dlp spawn failed: ${err.message}`)));

      ytDlp.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytDlp.on('close', (code) => {
        if (code === 0) {
          const [title, duration, uploader, timestamp] = output.trim().split('\n');
          const ts = parseInt(timestamp);
          resolve({
            title: title || 'Unknown',
            duration: parseInt(duration) || 0,
            uploader: uploader || 'Unknown',
            timestamp: !isNaN(ts) ? ts : undefined,
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

  private mergeStreams(outputTemplate: string): Promise<string> {
    const dir = path.dirname(outputTemplate);
    const files = fs.readdirSync(dir);
    const ytDlpFormatId = /\.f\d+\.\w+$/;

    // Trouver les fichiers video et audio séparés
    const formatFiles = files.filter(f => f.startsWith('vod_') && ytDlpFormatId.test(f));
    const videoFile = formatFiles.find(f => f.endsWith('.mp4') || f.endsWith('.webm') && !f.includes('f251'));
    const audioFile = formatFiles.find(f => f.includes('f251') || f.endsWith('.m4a') || f.endsWith('.opus'));

    if (!videoFile || !audioFile) {
      throw new Error(`Streams introuvables pour le merge: ${formatFiles.join(', ')}`);
    }

    // Extraire le timestamp du nom pour nommer le fichier mergé
    const tsMatch = videoFile.match(/^vod_(\d+)_/);
    const ts = tsMatch ? tsMatch[1] : Date.now().toString();
    const outputPath = path.join(dir, `vod_${ts}_merged.mp4`);

    this.logger.log(`🔀 Merge: ${videoFile} + ${audioFile} → ${path.basename(outputPath)}`);

    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-i', path.join(dir, videoFile),
        '-i', path.join(dir, audioFile),
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ]);

      proc.stderr.on('data', (data) => this.logger.debug(`ffmpeg merge: ${data.toString().trim()}`));

      proc.on('close', (code) => {
        if (code === 0) {
          // Nettoyer les fichiers séparés
          fs.unlinkSync(path.join(dir, videoFile));
          fs.unlinkSync(path.join(dir, audioFile));
          this.logger.log(`✅ Merge terminé: ${path.basename(outputPath)}`);
          resolve(outputPath);
        } else {
          reject(new Error(`ffmpeg merge exited with code ${code}`));
        }
      });
    });
  }

  private findDownloadedFile(outputTemplate: string): string | null {
    const dir = path.dirname(outputTemplate);
    const files = fs.readdirSync(dir);
    
    // Cherche le fichier le plus récent qui correspond au pattern
    const videoExtensions = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
    // Exclure les fichiers avec format ID yt-dlp (ex: .f251.webm, .f137.mp4 = streams séparés non mergés)
    const ytDlpFormatId = /\.f\d+\.\w+$/;
    const vodFiles = files
      .filter(f => f.startsWith('vod_') && videoExtensions.some(ext => f.endsWith(ext)) && !ytDlpFormatId.test(f))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        time: fs.statSync(path.join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    return vodFiles[0]?.path || null;
  }
}
