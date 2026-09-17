import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { AlignedSet, AlignmentReport } from '../../domain/alignment/alignment.types';
import {
  IVodRepository,
  VOD_REPOSITORY_TOKEN,
} from '../../domain/repositories/vod.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { CLIP_SET_QUEUE, CLIP_SET_JOB } from '../../infrastructure/queues/queue.constants';
import { ClipSetJobData } from '../../infrastructure/queues/clip-set.processor';

export interface GenerateClipsFromAlignmentInput {
  vodId: string;
  /**
   * Confiance minimale pour qu'un set soit découpé automatiquement.
   * En dessous, le set est listé dans `skipped` pour une revue manuelle.
   */
  minConfidence?: number;
  /** Découper aussi les sets repliés sur les timestamps Start.gg seuls. */
  includeApiOnly?: boolean;
}

export interface GenerateClipsFromAlignmentResult {
  vodId: string;
  enqueuedSets: number;
  skippedSets: Array<{ roundName: string; players: string; reason: string }>;
  message: string;
}

const DEFAULT_MIN_CONFIDENCE = 0.45;

@Injectable()
export class GenerateClipsFromAlignmentUseCase {
  private readonly logger = new Logger(GenerateClipsFromAlignmentUseCase.name);
  private readonly storageDir = path.join(process.cwd(), 'storage', 'clips');

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @InjectQueue(CLIP_SET_QUEUE)
    private readonly queue: Queue,
  ) {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  async execute(
    input: GenerateClipsFromAlignmentInput,
  ): Promise<GenerateClipsFromAlignmentResult> {
    const { vodId } = input;
    const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const includeApiOnly = input.includeApiOnly ?? false;

    const vod: any = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.filePath || !fs.existsSync(vod.filePath)) {
      throw new BadRequestException('Fichier VOD introuvable.');
    }

    const report = vod.alignment as AlignmentReport | null;
    if (!report?.aligned?.length) {
      throw new BadRequestException(
        'Aucun alignement disponible : lancez POST /vods/:id/align avant de générer les clips.',
      );
    }

    const skipped: GenerateClipsFromAlignmentResult['skippedSets'] = [];
    const pending: ClipSetJobData[] = [];

    report.aligned.forEach((entry, index) => {
      const reason = this.rejectionReason(
        entry,
        minConfidence,
        includeApiOnly,
        vod.duration ?? 0,
      );
      if (reason) {
        skipped.push({
          roundName: entry.set.roundName,
          players: entry.set.players,
          reason,
        });
        return;
      }

      const setOrder = index + 1;
      const safeRound = (entry.set.roundName ?? `set_${setOrder}`).replace(
        /[^a-zA-Z0-9_-]/g,
        '_',
      );

      pending.push({
        vodId,
        setOrder,
        setStartGGId: entry.set.setStartGGId,
        inputPath: vod.filePath,
        outputPath: path.join(
          this.storageDir,
          `${vodId}_set${setOrder}_${safeRound}.mp4`,
        ),
        startSeconds: entry.startSeconds,
        endSeconds: entry.endSeconds,
        totalSets: 0,
        title: this.buildTitle(entry),
        roundName: entry.set.phaseName
          ? `${entry.set.phaseName} - ${entry.set.roundName}`
          : entry.set.roundName,
        players: entry.set.players,
        score: entry.set.score,
      });
    });

    if (pending.length === 0) {
      throw new BadRequestException(
        `Aucun set ne dépasse le seuil de confiance ${minConfidence}. ${skipped.length} set(s) à revoir manuellement.`,
      );
    }

    for (const job of pending) {
      job.totalSets = pending.length;
      await this.queue.add(CLIP_SET_JOB, job, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });
      this.logger.log(
        `✅ Set ${job.setOrder} enqueued: [${job.startSeconds}s → ${job.endSeconds}s] — ${job.players}`,
      );
    }

    await this.vodRepository.update(vodId, { status: VodStatus.PROCESSING });

    return {
      vodId,
      enqueuedSets: pending.length,
      skippedSets: skipped,
      message: `${pending.length} clip(s) en génération, ${skipped.length} set(s) écarté(s) pour revue manuelle.`,
    };
  }

  /** Renvoie la raison de l'exclusion, ou null si le set est découpable. */
  private rejectionReason(
    entry: AlignedSet,
    minConfidence: number,
    includeApiOnly: boolean,
    vodDuration: number,
  ): string | null {
    if (entry.set.gameCount === 0) return 'Set gagné par forfait';
    if (entry.source === 'api' && !includeApiOnly) {
      return 'Aucune game détectée dans la vidéo';
    }
    if (entry.confidence < minConfidence) {
      return `Confiance ${entry.confidence.toFixed(2)} sous le seuil ${minConfidence}`;
    }
    if (entry.endSeconds <= entry.startSeconds) return 'Bornes invalides';
    if (vodDuration > 0 && entry.startSeconds >= vodDuration) {
      return 'Set situé après la fin de la VOD';
    }
    return null;
  }

  private buildTitle(entry: AlignedSet): string {
    const prefix = entry.set.phaseName ? `${entry.set.phaseName} - ` : '';
    return `${prefix}${entry.set.roundName} — ${entry.set.players}`;
  }
}
