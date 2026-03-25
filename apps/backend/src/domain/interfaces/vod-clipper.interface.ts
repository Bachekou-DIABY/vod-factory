export const VOD_CLIPPER_TOKEN = 'VOD_CLIPPER_TOKEN';

export interface ClipOptions {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ClipResult {
  outputPath: string;
  fileSize: number;
}

export interface IVodClipper {
  clip(options: ClipOptions): Promise<ClipResult>;
}
