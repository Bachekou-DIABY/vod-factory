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

  /**
   * Renvoie le dernier rapport d'alignement, ou `null` s'il n'y en a pas.
   *
   * Pas de 404 : une VOD sans analyse est un état normal, pas une erreur. La
   * renvoyer en 404 faisait remonter des erreurs dans la console du navigateur
   * à chaque ouverture de page. Une VOD inexistante, elle, reste une 404.
   */
  @Get(':id/alignment')
  async getAlignment(@Param('id') id: string) {
    return this.alignVodSets.getReport(id);
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
  async getSignal(
    @Param('id') id: string,
    @Query('points') points?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const vod: any = await this.vodRepository.findById(id);
    if (!vod) throw new NotFoundException(`VOD ${id} non trouvée`);

    const signal = this.signalStore.decode(vod.hudSignal, vod.signalSampleRate);
    if (!signal) {
      throw new NotFoundException(
        'Aucun signal stocké. Lancez POST /vods/:id/align au moins une fois.',
      );
    }

    // Fenêtrage : sans lui, une VOD de dix heures ne se lit qu'à un échantillon
    // toutes les sept secondes, trop grossier pour situer une frontière de game.
    const toIndex = (seconds: string | undefined, defaut: number) => {
      const v = parseInt(seconds ?? '', 10);
      if (!isFinite(v)) return defaut;
      return Math.max(
        0,
        Math.min(signal.hud.length, Math.round((v - signal.startSeconds) * signal.sampleRate)),
      );
    };

    const debut = toIndex(from, 0);
    const fin = Math.max(debut + 1, toIndex(to, signal.hud.length));

    const target = Math.max(50, Math.min(20000, parseInt(points ?? '1000', 10) || 1000));
    const stride = Math.max(1, Math.floor((fin - debut) / target));

    const series: Array<{ t: number; hud: number; dark: number }> = [];
    for (let i = debut; i < fin; i += stride) {
      series.push({
        t: Math.round(signal.startSeconds + i / signal.sampleRate),
        hud: +(signal.hud[i] / 255).toFixed(4),
        dark: +(signal.dark[i] / 255).toFixed(4),
      });
    }

    // 20 classes de largeur 0.05 sur le canal HUD, sur la fenêtre demandée.
    const histogram = new Array(20).fill(0);
    for (let i = debut; i < fin; i++) {
      const bucket = Math.min(19, Math.floor((signal.hud[i] / 255) * 20));
      histogram[bucket]++;
    }

    return {
      sampleRate: signal.sampleRate,
      samples: signal.hud.length,
      window: {
        fromSeconds: Math.round(signal.startSeconds + debut / signal.sampleRate),
        toSeconds: Math.round(signal.startSeconds + fin / signal.sampleRate),
      },
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
