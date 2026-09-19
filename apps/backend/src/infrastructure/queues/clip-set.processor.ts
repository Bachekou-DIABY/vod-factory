import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CLIP_SET_QUEUE, CLIP_SET_JOB } from './queue.constants';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';

export interface ClipSetJobData {
  vodId: string;
  setOrder: number;
  setStartGGId?: string;
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
  totalSets: number;
  title?: string;
  roundName?: string;
  players?: string;
  score?: string;
}

@Processor(CLIP_SET_QUEUE, { concurrency: 4 })
export class ClipSetProcessor extends WorkerHost {
  private readonly logger = new Logger(ClipSetProcessor.name);

  constructor(
    @Inject(VOD_CLIPPER_TOKEN)
    private readonly clipper: IVodClipper,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @InjectQueue(CLIP_SET_QUEUE)
    private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name === CLIP_SET_JOB) {
      return this.processClipSet(job as Job<ClipSetJobData>);
    }
  }

  private async processClipSet(job: Job<ClipSetJobData>): Promise<void> {
    const { vodId, setOrder, setStartGGId, inputPath, outputPath, startSeconds, endSeconds, title, roundName, players, score } = job.data;

    this.logger.log(`✂️ [Job ${job.id}] Set ${setOrder} de VOD ${vodId}: [${startSeconds}s → ${endSeconds}s]`);

    const result = await this.clipper.clip({ inputPath, outputPath, startSeconds, endSeconds });

    // Auto-thumbnail : frame à 50% de la durée du clip
    const thumbnailDir = path.join(process.cwd(), 'storage', 'thumbnails');
    fs.mkdirSync(thumbnailDir, { recursive: true });
    const clipBase = path.basename(result.outputPath, path.extname(result.outputPath));
    const thumbnailPath = path.join(thumbnailDir, `${clipBase}.jpg`);
    const midpoint = Math.floor((endSeconds - startSeconds) / 2);
    await this.extractThumbnail(result.outputPath, thumbnailPath, midpoint);

    // Un set déjà découpé est remplacé, pas dupliqué. Sans ça, chaque
    // regénération ajoutait une ligne pointant sur le même fichier : 25 clips en
    // base pour 22 sets, et autant d'uploads YouTube en double à la clé.
    const existants = await this.clipRepository.findByVodId(vodId);
    const deja = setStartGGId
      ? existants.find((c) => c.setStartGGId === setStartGGId)
      : undefined;

    if (deja) {
      if (deja.youtubeVideoId) {
        this.logger.warn(
          `⚠️ Set ${setOrder} redécoupé alors qu'il est déjà sur YouTube (${deja.youtubeVideoId}) : la vidéo en ligne ne correspond plus au fichier local.`,
        );
      }
      // Le statut, la description et le lien YouTube sont conservés : ils
      // portent du travail manuel que le redécoupage n'invalide pas.
      await this.clipRepository.update(deja.id, {
        filePath: result.outputPath,
        startSeconds,
        endSeconds,
        title,
        roundName,
        players,
        score,
        thumbnailPath,
      });
      this.logger.log(`♻️ [Job ${job.id}] Set ${setOrder} remplacé: ${result.outputPath}`);
    } else {
      await this.clipRepository.create({
        vodId,
        setOrder,
        setStartGGId,
        filePath: result.outputPath,
        startSeconds,
        endSeconds,
        title,
        roundName,
        players,
        score,
        thumbnailPath,
        privacyStatus: 'unlisted',
        status: 'PENDING',
      });
      this.logger.log(`✅ [Job ${job.id}] Set ${setOrder} clipé: ${result.outputPath}`);
    }

    // La VOD n'est terminée que lorsque plus aucun job ne la concerne. Compter
    // les clips ne suffit pas : après un redécoupage, leur nombre atteint la
    // cible dès le premier job et la VOD basculait en COMPLETED trop tôt.
    if (await this.plusAucunJobPour(vodId, job.id)) {
      await this.vodRepository.update(vodId, { status: VodStatus.COMPLETED });
      this.logger.log(`🏁 VOD ${vodId} COMPLETED`);
    }
  }

  /** Reste-t-il des découpages en file pour cette VOD, hors celui en cours ? */
  private async plusAucunJobPour(vodId: string, jobId?: string): Promise<boolean> {
    const restants = await this.queue.getJobs([
      'waiting',
      'active',
      'delayed',
      'paused',
    ]);
    return !restants.some(
      (j) => j && j.id !== jobId && (j.data as ClipSetJobData)?.vodId === vodId,
    );
  }

  private extractThumbnail(inputPath: string, outputPath: string, seekSeconds: number): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-ss', String(Math.max(0, seekSeconds)),
        '-i', inputPath,
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        outputPath,
      ]);
      proc.on('close', (code) => {
        if (code !== 0) this.logger.warn(`Thumbnail auto échouée pour ${inputPath}`);
        resolve(); // Ne pas bloquer le job si la thumbnail échoue
      });
    });
  }
}
