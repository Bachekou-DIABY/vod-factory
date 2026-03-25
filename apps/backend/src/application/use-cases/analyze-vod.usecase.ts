import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { spawn } from 'child_process';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { VOD_PROCESSING_QUEUE, ANALYZE_CHUNK_JOB } from '../../infrastructure/queues/queue.constants';
import { AnalyzeChunkJobData } from '../../infrastructure/queues/analyze-chunk.processor';

const CHUNK_DURATION = 3600;  // 1h par chunk
const CHUNK_OVERLAP  = 60;    // 60s d'overlap aux frontières

export interface AnalyzeVodResult {
  vodId: string;
  totalChunks: number;
  message: string;
}

@Injectable()
export class AnalyzeVodUseCase {
  private readonly logger = new Logger(AnalyzeVodUseCase.name);

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @InjectQueue(VOD_PROCESSING_QUEUE)
    private readonly queue: Queue,
  ) {}

  async execute(vodId: string): Promise<AnalyzeVodResult> {
    const vod = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.filePath) throw new NotFoundException(`VOD ${vodId} n'a pas de fichier local`);

    this.logger.log(`🎬 Démarrage analyse parallèle VOD: ${vodId}`);

    // 1. Durée réelle via ffprobe
    const duration = await this.getVodDuration(vod.filePath);
    this.logger.log(`⏱️ Durée VOD: ${duration}s (${(duration / 3600).toFixed(1)}h)`);

    // 2. Découpage en chunks de 1h avec 60s d'overlap
    const chunks = this.buildChunks(duration);
    const totalChunks = chunks.length;
    this.logger.log(`📦 ${totalChunks} chunks créés (${CHUNK_DURATION}s + ${CHUNK_OVERLAP}s overlap)`);

    // 3. Marquer la VOD comme en cours d'analyse
    await (this.vodRepository as any).update(vodId, {
      status: VodStatus.PROCESSING,
      totalChunks,
      completedChunks: 0,
    });

    // 4. Publier tous les jobs en parallèle
    const jobs: AnalyzeChunkJobData[] = chunks.map((chunk, i) => ({
      vodId,
      chunkIndex: i,
      totalChunks,
      startSeconds: chunk.start,
      endSeconds: chunk.end,
      filePath: vod.filePath!,
    }));

    await Promise.all(jobs.map(data => this.queue.add(ANALYZE_CHUNK_JOB, data)));

    this.logger.log(`🚀 ${totalChunks} jobs analyze-chunk publiés pour VOD ${vodId}`);

    return { vodId, totalChunks, message: `Analyse démarrée : ${totalChunks} chunks en parallèle` };
  }

  private buildChunks(duration: number): { start: number; end: number }[] {
    const chunks: { start: number; end: number }[] = [];
    for (let start = 0; start < duration; start += CHUNK_DURATION) {
      const end = Math.min(start + CHUNK_DURATION + CHUNK_OVERLAP, duration);
      chunks.push({ start, end });
    }
    return chunks;
  }

  private getVodDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      let output = '';
      proc.stdout.on('data', (d: Buffer) => (output += d.toString()));
      proc.on('close', (code: number) => {
        if (code === 0) resolve(Math.floor(parseFloat(output.trim())));
        else reject(new Error(`ffprobe failed with code ${code}`));
      });
    });
  }
}
