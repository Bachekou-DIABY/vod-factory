export const VOD_DOWNLOAD_SERVICE_TOKEN = Symbol('VOD_DOWNLOAD_SERVICE_TOKEN');

export interface DownloadProgress {
  percent: number;
  downloadedSize: string;
  totalSize?: string;
  speed: string;
  eta?: string;
}

export interface DownloadResult {
  filePath: string;
  fileSize: number;
  duration: number;
  resolution: string;
  fps: number;
}

export interface IVodDownloadService {
  download(url: string, outputPath: string, onProgress?: (progress: DownloadProgress) => void): Promise<DownloadResult>;
  getVideoInfo(url: string): Promise<{ title: string; duration: number; uploader: string }>;
}
