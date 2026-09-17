import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AlignVodSetsUseCase } from '../../application/use-cases/align-vod-sets.usecase';
import { GenerateClipsFromAlignmentUseCase } from '../../application/use-cases/generate-clips-from-alignment.usecase';
import {
  IVodRepository,
  VOD_REPOSITORY_TOKEN,
} from '../../domain/repositories/vod.repository.interface';
import { SignalStore } from '../persistence/signal.store';
import { VOD_ALIGN_QUEUE, ALIGN_VOD_JOB } from '../queues/queue.constants';
import { AlignVodJobData } from '../queues/align-vod.processor';

class AlignVodDto {
  eventStartGGId?: string;
  streamName?: string;
  vodRecordedAtUnix?: number;
  useOcrValidation?: boolean;
  reuseStoredSignal?: boolean;
  keyframesOnly?: boolean;
  preRollSeconds?: number;
  postRollSeconds?: number;
}

class GenerateClipsDto {
  minConfidence?: number;
  includeApiOnly?: boolean;
}

/**
 * Pipeline d'alignement : détection vidéo permissive recalée sur la structure
 * Start.gg. Séparé de VodController pour ne pas alourdir davantage celui-ci.
 */
@Controller('vods')
export class VodAlignmentController {
  private readonly logger = new Logger(VodAlignmentController.name);

  constructor(
    private readonly alignVodSets: AlignVodSetsUseCase,
    private readonly generateClips: GenerateClipsFromAlignmentUseCase,
    private readonly signalStore: SignalStore,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @InjectQueue(VOD_ALIGN_QUEUE)
    private readonly alignQueue: Queue,
  ) {}

  /** Lance l'alignement en tâche de fond. Décode toute la VOD une fois. */
  @Post(':id/align')
  async align(@Param('id') id: string, @Body() dto: AlignVodDto) {
    const vod: any = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);
    if (!vod.filePath) {
      throw new BadRequestException('La VOD doit être téléchargée avant l\'alignement.');
    }

    const data: AlignVodJobData = { vodId: id, ...dto };
    const job = await this.alignQueue.add(ALIGN_VOD_JOB, data, {
      attempts: 1,
      removeOnComplete: 20,
      removeOnFail: 20,
    });

    this.logger.log(`🎯 Alignement VOD ${id} mis en file (job ${job.id})`);
    return {
      jobId: job.id,
      message:
        'Alignement lancé. Suivez la progression dans les logs, puis GET /vods/:id/alignment.',
    };
  }

  /** Renvoie le dernier rapport d'alignement calculé pour cette VOD. */
  @Get(':id/alignment')
  async getAlignment(@Param('id') id: string) {
    const report = await this.alignVodSets.getReport(id);
    if (!report) {
      throw new NotFoundException(
        'Aucun alignement pour cette VOD. Lancez POST /vods/:id/align.',
      );
    }
    return report;
  }

  /** Génère les clips à partir du rapport, en écartant les sets peu sûrs. */
  @Post(':id/clips-from-alignment')
  async clipsFromAlignment(@Param('id') id: string, @Body() dto: GenerateClipsDto) {
    this.logger.log(`✂️ Génération des clips alignés pour VOD ${id}`);
    return this.generateClips.execute({ vodId: id, ...dto });
  }

  /**
   * Diagnostic : signal HUD sous-échantillonné et histogramme.
   *
   * La zone HUD est en dur et l'overlay de chaque TO est différent. Cet
   * endpoint permet de vérifier que le signal est bien bimodal, et de régler
   * `enterThreshold` / `exitThreshold` sans tâtonner.
   */
  @Get(':id/alignment/signal')
  async getSignal(@Param('id') id: string, @Query('points') points?: string) {
    const vod: any = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);

    const signal = this.signalStore.decode(vod.hudSignal, vod.signalSampleRate);
    if (!signal) {
      throw new NotFoundException(
        'Aucun signal stocké. Lancez POST /vods/:id/align au moins une fois.',
      );
    }

    const target = Math.max(50, Math.min(5000, parseInt(points ?? '1000', 10) || 1000));
    const stride = Math.max(1, Math.floor(signal.hud.length / target));

    const series: Array<{ t: number; hud: number; dark: number }> = [];
    for (let i = 0; i < signal.hud.length; i += stride) {
      series.push({
        t: Math.round(signal.startSeconds + i / signal.sampleRate),
        hud: +(signal.hud[i] / 255).toFixed(4),
        dark: +(signal.dark[i] / 255).toFixed(4),
      });
    }

    // 20 classes de largeur 0.05 sur le canal HUD.
    const histogram = new Array(20).fill(0);
    for (let i = 0; i < signal.hud.length; i++) {
      const bucket = Math.min(19, Math.floor((signal.hud[i] / 255) * 20));
      histogram[bucket]++;
    }

    return {
      sampleRate: signal.sampleRate,
      samples: signal.hud.length,
      stride,
      series,
      histogram: histogram.map((count, i) => ({
        from: +(i * 0.05).toFixed(2),
        to: +((i + 1) * 0.05).toFixed(2),
        count,
      })),
    };
  }
}
