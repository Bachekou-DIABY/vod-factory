import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { VodStatus } from '../../domain/entities/vod.entity';

export interface ClipVodResult {
  vodId: string;
  clipPath: string;
  startSeconds: number;
  endSeconds: number;
  fileSize: number;
}

@Injectable()
export class ClipVodUseCase {
  private readonly logger = new Logger(ClipVodUseCase.name);

  // Buffer ajouté avant le début et après la fin du set
  private readonly bufferSeconds = 15;

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(VOD_CLIPPER_TOKEN)
    private readonly clipper: IVodClipper,
  ) {}

  async execute(vodId: string): Promise<ClipVodResult> {
    const vod = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.filePath) throw new NotFoundException(`VOD ${vodId} n'a pas de fichier local`);
    if (vod.startTime == null || vod.endTime == null) {
      throw new Error(`VOD ${vodId} n'a pas encore été analysée (startTime/endTime manquants)`);
    }

    const startSeconds = Math.max(0, vod.startTime - this.bufferSeconds);
    const endSeconds = vod.endTime + this.bufferSeconds;

    const clipsDir = path.join(process.cwd(), 'storage', 'clips');
    const outputPath = path.join(clipsDir, `${vodId}.mp4`);

    this.logger.log(`✂️ VOD ${vodId}: clip [${startSeconds}s → ${endSeconds}s]`);

    const result = await this.clipper.clip({
      inputPath: vod.filePath,
      outputPath,
      startSeconds,
      endSeconds,
    });

    await this.vodRepository.update(vodId, {
      processedUrl: result.outputPath,
      status: VodStatus.COMPLETED,
    });

    this.logger.log(`✅ VOD ${vodId} clippée et marquée COMPLETED`);

    return {
      vodId,
      clipPath: result.outputPath,
      startSeconds,
      endSeconds,
      fileSize: result.fileSize,
    };
  }
}
