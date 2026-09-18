import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import {
  AlignedSet,
  AlignmentReport,
  ExpectedSet,
  FrameSignal,
  GameCandidate,
} from '../../domain/alignment/alignment.types';
import {
  IVodRepository,
  VOD_REPOSITORY_TOKEN,
} from '../../domain/repositories/vod.repository.interface';
import {
  IStartGGService,
  STARTGG_SERVICE_TOKEN,
  StartGGSetResponse,
} from '../../domain/services/startgg.service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { FrameSignalService, HudZone } from '../../infrastructure/external-services/frame-signal.service';
import { TimerOcrValidatorService } from '../../infrastructure/external-services/timer-ocr-validator.service';
import { estimateGameCount } from '../alignment/score-parser';
import {
  DEFAULT_SEGMENTER_OPTIONS,
  RELAXED_SEGMENTER_OPTIONS,
  resegmentWindow,
  segment,
} from '../alignment/segmenter';
import { OffsetEstimate, estimateBias } from '../alignment/offset-estimator';
import { filterSetsToVodWindow } from '../alignment/vod-window';
import { splitToMatchCount } from '../alignment/game-splitter';
import {
  DEFAULT_CLIP_BOUNDS_OPTIONS,
  trimDeadPreRoll,
} from '../alignment/clip-bounds';
import {
  AlignerOptions,
  DEFAULT_ALIGNER_OPTIONS,
  alignSets,
} from '../alignment/set-aligner';
import { SignalStore } from '../../infrastructure/persistence/signal.store';

export interface AlignVodSetsInput {
  vodId: string;
  eventStartGGId?: string;
  streamName?: string;
  /** Force le début de stream, en Unix seconds. Sinon `vod.recordedAt`. */
  vodRecordedAtUnix?: number;
  /** Valide les games détectées par OCR du timer. Plus lent, plus sûr. */
  useOcrValidation?: boolean;
  /** Réutilise le signal déjà stocké au lieu de redécoder la VOD. */
  reuseStoredSignal?: boolean;
  /**
   * Ne décode que les keyframes : environ dix fois plus rapide, précision
   * temporelle de l'ordre de la seconde. Activé par défaut, à désactiver
   * seulement si les frontières de clip sont visiblement trop grossières.
   */
  keyframesOnly?: boolean;
  hudZone?: HudZone;
  preRollSeconds?: number;
  postRollSeconds?: number;
}

/** Marge de recherche autour d'un set dont le nombre de games ne colle pas. */
const REFINE_WINDOW_PADDING_SECONDS = 120;
/** Recouvrement au-delà duquel un candidat relâché est considéré comme doublon. */
const DUPLICATE_OVERLAP_RATIO = 0.5;

@Injectable()
export class AlignVodSetsUseCase {
  private readonly logger = new Logger(AlignVodSetsUseCase.name);

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
    private readonly frameSignal: FrameSignalService,
    private readonly ocrValidator: TimerOcrValidatorService,
    private readonly signalStore: SignalStore,
  ) {}

  async execute(input: AlignVodSetsInput): Promise<AlignmentReport> {
    const vod: any = await this.vodRepository.findById(input.vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${input.vodId}`);
    if (!vod.filePath || !fs.existsSync(vod.filePath)) {
      throw new BadRequestException(
        'Fichier VOD introuvable. La VOD doit être téléchargée avant l\'alignement.',
      );
    }

    const eventStartGGId = input.eventStartGGId ?? vod.eventStartGGId;
    if (!eventStartGGId) {
      throw new BadRequestException(
        'eventStartGGId introuvable : associez un event à la VOD ou fournissez-le.',
      );
    }

    const recordedAtUnix = this.resolveRecordedAt(vod, input.vodRecordedAtUnix);
    const durationSeconds = vod.duration ?? 0;
    if (durationSeconds <= 0) {
      throw new BadRequestException(
        'Durée de la VOD inconnue : relancez un probe ffprobe avant l\'alignement.',
      );
    }

    // Mémorise le calage fourni, comme le fait la génération par timestamps :
    // sans ça, un calage manuel serait à refournir à chaque appel.
    if (input.vodRecordedAtUnix !== undefined) {
      await this.vodRepository.update(input.vodId, {
        recordedAt: new Date(input.vodRecordedAtUnix * 1000),
      });
    }

    const onStreamSets = await this.loadExpectedSets(
      eventStartGGId,
      input.streamName ?? vod.streamName,
    );

    // Un stream découpé en plusieurs VODs renvoie quand même tous ses sets :
    // on ne garde que ceux que cette partie peut contenir.
    const { kept: sets, dropped } = filterSetsToVodWindow(
      onStreamSets,
      recordedAtUnix,
      durationSeconds,
    );
    if (dropped.length > 0) {
      this.logger.log(
        `✂️ ${dropped.length} set(s) hors de la fenêtre de la VOD, écartés avant alignement`,
      );
    }
    if (sets.length === 0) {
      throw new BadRequestException(
        `Aucun des ${onStreamSets.length} sets on-stream ne tombe dans la fenêtre de cette VOD. ` +
          `Vérifiez recordedAt (${new Date(recordedAtUnix * 1000).toISOString()}) et la durée (${durationSeconds}s).`,
      );
    }

    this.logger.log(
      `🎯 Alignement VOD ${input.vodId} — ${sets.length} sets retenus sur ${onStreamSets.length} on-stream, durée ${durationSeconds}s`,
    );

    await this.vodRepository.update(input.vodId, { status: VodStatus.PROCESSING });

    try {
      const signal = await this.obtainSignal(input, vod);

      // Détection permissive : les faux positifs sont éliminés par l'alignement.
      let candidates = segment(signal, DEFAULT_SEGMENTER_OPTIONS);
      this.logger.log(`🎮 ${candidates.length} games candidates détectées`);

      if (input.useOcrValidation) {
        candidates = await this.ocrValidator.validate(
          vod.filePath,
          candidates,
          input.hudZone,
        );
      }

      const bias = estimateBias(
        candidates,
        sets,
        recordedAtUnix,
        durationSeconds,
      );
      this.logger.log(
        `🕰️ Biais Start.gg estimé: ${bias.biasSeconds}s (confiance ${bias.confidence.toFixed(2)}, ${bias.setsUsed} sets)`,
      );

      const alignerOptions: AlignerOptions = {
        ...DEFAULT_ALIGNER_OPTIONS,
        preRollSeconds: input.preRollSeconds ?? DEFAULT_ALIGNER_OPTIONS.preRollSeconds,
        postRollSeconds: input.postRollSeconds ?? DEFAULT_ALIGNER_OPTIONS.postRollSeconds,
        biasSeconds: bias.biasSeconds,
        recordedAtUnix,
        vodDurationSeconds: durationSeconds,
      };

      let aligned = alignSets(sets, candidates, alignerOptions);

      // Passe de rattrapage : là où le score annonce plus de games qu'on n'en a
      // trouvées, on re-segmente la fenêtre avec des seuils relâchés. Le signal
      // est déjà en mémoire, donc c'est gratuit.
      const extra = this.collectMissingGames(signal, aligned);
      if (extra.length > 0) {
        this.logger.log(
          `🔁 Re-scan relâché: ${extra.length} game(s) supplémentaire(s) récupérée(s)`,
        );
        candidates = this.mergeCandidates(candidates, extra);
        aligned = alignSets(sets, candidates, alignerOptions);
      }

      // Dernier recours : là où le score annonce encore plus de games qu'on
      // n'en a, c'est que deux d'entre elles sont recollées. On coupe la plus
      // longue à son creux de noirceur, autant de fois que nécessaire.
      const decoupees = this.splitMergedGames(signal, aligned);
      if (decoupees > 0) {
        this.logger.log(
          `✂️ ${decoupees} game(s) recollée(s) séparée(s) d'après le score Start.gg`,
        );
        candidates = this.rebuildCandidates(aligned, candidates);
        aligned = alignSets(sets, candidates, alignerOptions);
      }

      // Le début de clip est enfin recalé sur le contenu de l'image, pour ne pas
      // ouvrir sur l'écran d'attente qui précède souvent un set.
      const avant = aligned;
      aligned = trimDeadPreRoll(signal, aligned, {
        ...DEFAULT_CLIP_BOUNDS_OPTIONS,
        // Rester cohérent avec la marge demandée : le recalage raccourcit, il
        // ne doit jamais rallonger le clip.
        preRollSeconds: alignerOptions.preRollSeconds,
      });
      const recalés = aligned.filter((a, i) => a.startSeconds !== avant[i].startSeconds);
      if (recalés.length > 0) {
        this.logger.log(
          `✂️ ${recalés.length} début(s) de clip recalé(s) pour ne pas ouvrir sur une image morte`,
        );
      }

      const report = this.buildReport(input.vodId, bias, candidates, aligned);
      await this.persist(input.vodId, report, signal);

      this.logger.log(
        `✅ Alignement terminé — ${report.setsFromVideo} sets exacts, ${report.setsPartial} partiels, ${report.setsFromApiOnly} sur API seule`,
      );

      return report;
    } catch (err) {
      await this.vodRepository.update(input.vodId, { status: VodStatus.FAILED });
      throw err;
    }
  }

  /** Renvoie le rapport déjà calculé, sans relancer d'analyse. */
  async getReport(vodId: string): Promise<AlignmentReport | null> {
    const vod: any = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    return (vod.alignment as AlignmentReport | null) ?? null;
  }

  private resolveRecordedAt(vod: any, override?: number): number {
    if (override !== undefined) return override;
    if (vod.recordedAt) return Math.floor(new Date(vod.recordedAt).getTime() / 1000);
    throw new BadRequestException(
      'La VOD n\'a pas de recordedAt : fournissez vodRecordedAtUnix pour caler le début de stream.',
    );
  }

  private async loadExpectedSets(
    eventStartGGId: string,
    streamName?: string,
  ): Promise<ExpectedSet[]> {
    const all = await this.startGGService.getAllSetsByEventId(
      eventStartGGId,
      streamName,
    );
    const onStream = streamName ? all : all.filter((s) => s.stream);

    if (!onStream.length) {
      throw new BadRequestException(
        `Aucun set on-stream trouvé pour l'event ${eventStartGGId}`,
      );
    }

    return onStream.map((s) => this.toExpectedSet(s));
  }

  private toExpectedSet(set: StartGGSetResponse): ExpectedSet {
    const counts = estimateGameCount(set.score, set.totalGames);
    return {
      setStartGGId: set.id,
      roundName: set.roundName,
      phaseName: set.phaseName,
      players: `${set.player1.name} vs ${set.player2.name}`,
      score: set.score,
      apiStartUnix: set.startTime
        ? Math.floor(new Date(set.startTime).getTime() / 1000)
        : undefined,
      apiEndUnix: set.endTime
        ? Math.floor(new Date(set.endTime).getTime() / 1000)
        : undefined,
      gameCount: counts.gameCount,
      minGames: counts.minGames,
      maxGames: counts.maxGames,
    };
  }

  private async obtainSignal(
    input: AlignVodSetsInput,
    vod: any,
  ): Promise<FrameSignal> {
    if (input.reuseStoredSignal) {
      const stored = this.signalStore.decode(vod.hudSignal, vod.signalSampleRate);
      if (stored) {
        this.logger.log(
          `♻️ Signal réutilisé depuis la base (${stored.hud.length} échantillons)`,
        );
        return stored;
      }
      this.logger.warn('Aucun signal stocké, décodage complet de la VOD');
    }

    return this.frameSignal.computeSignal(vod.filePath, {
      sampleRate: 1,
      hudZone: input.hudZone,
      keyframesOnly: input.keyframesOnly ?? true,
      endSeconds: vod.duration,
      onProgress: (ratio) =>
        this.logger.log(`⏳ Signal ${Math.round(ratio * 100)}%`),
    });
  }

  /**
   * Pour chaque set où il manque des games par rapport au score Start.gg,
   * re-segmente sa fenêtre avec des seuils plus bas et renvoie les intervalles
   * qui n'étaient pas déjà connus.
   */
  private collectMissingGames(
    signal: FrameSignal,
    aligned: AlignedSet[],
  ): GameCandidate[] {
    const extra: GameCandidate[] = [];

    for (const entry of aligned) {
      const expected = entry.set.gameCount;
      if (expected === null || expected === 0) continue;
      if (entry.games.length >= expected) continue;

      const from = entry.startSeconds - REFINE_WINDOW_PADDING_SECONDS;
      const to = entry.endSeconds + REFINE_WINDOW_PADDING_SECONDS;

      const relaxed = resegmentWindow(signal, from, to, RELAXED_SEGMENTER_OPTIONS);
      for (const candidate of relaxed) {
        if (!this.overlapsAny(candidate, entry.games)) extra.push(candidate);
      }
    }

    return extra;
  }

  /**
   * Découpe les games recollées des sets encore incomplets. Mute `aligned` et
   * renvoie le nombre de coupes réalisées.
   */
  private splitMergedGames(signal: FrameSignal, aligned: AlignedSet[]): number {
    let coupes = 0;

    for (const entry of aligned) {
      const attendu = entry.set.gameCount;
      if (attendu === null || attendu === 0) continue;
      if (entry.games.length >= attendu) continue;

      const avant = entry.games.length;
      entry.games = splitToMatchCount(entry.games, signal, attendu);
      coupes += entry.games.length - avant;
    }

    return coupes;
  }

  /**
   * Reconstruit la liste globale de candidats à partir des games réparties,
   * en conservant les orphelins que l'alignement n'avait attribués à personne.
   */
  private rebuildCandidates(
    aligned: AlignedSet[],
    precedents: GameCandidate[],
  ): GameCandidate[] {
    const attribues = aligned.flatMap((a) => a.games);
    const orphelins = precedents.filter((c) => !this.overlapsAny(c, attribues));
    return [...attribues, ...orphelins].sort(
      (a, b) => a.startSeconds - b.startSeconds,
    );
  }

  private overlapsAny(candidate: GameCandidate, known: GameCandidate[]): boolean {
    const length = Math.max(1, candidate.endSeconds - candidate.startSeconds);
    return known.some((other) => {
      const overlap =
        Math.min(candidate.endSeconds, other.endSeconds) -
        Math.max(candidate.startSeconds, other.startSeconds);
      return overlap / length > DUPLICATE_OVERLAP_RATIO;
    });
  }

  private mergeCandidates(
    base: GameCandidate[],
    extra: GameCandidate[],
  ): GameCandidate[] {
    const merged = [...base];
    for (const candidate of extra) {
      if (!this.overlapsAny(candidate, merged)) merged.push(candidate);
    }
    return merged.sort((a, b) => a.startSeconds - b.startSeconds);
  }

  /** Candidats qu'aucun set n'a retenus, pour le diagnostic. */
  private findOrphans(
    candidates: GameCandidate[],
    aligned: AlignedSet[],
  ): GameCandidate[] {
    const retenus = new Set<string>();
    for (const set of aligned) {
      for (const game of set.games) {
        retenus.add(`${game.startSeconds}-${game.endSeconds}`);
      }
    }
    return candidates.filter(
      (c) => !retenus.has(`${c.startSeconds}-${c.endSeconds}`),
    );
  }

  private buildReport(
    vodId: string,
    bias: OffsetEstimate,
    candidates: GameCandidate[],
    aligned: AlignedSet[],
  ): AlignmentReport {
    return {
      vodId,
      biasSeconds: bias.biasSeconds,
      biasConfidence: bias.confidence,
      candidatesDetected: candidates.length,
      orphans: this.findOrphans(candidates, aligned),
      setsTotal: aligned.length,
      setsFromVideo: aligned.filter((a) => a.source === 'video').length,
      setsPartial: aligned.filter((a) => a.source === 'video-partial').length,
      setsFromApiOnly: aligned.filter((a) => a.source === 'api').length,
      aligned,
      generatedAt: new Date().toISOString(),
    };
  }

  private async persist(
    vodId: string,
    report: AlignmentReport,
    signal: FrameSignal,
  ): Promise<void> {
    await this.vodRepository.update(vodId, {
      status: VodStatus.PROCESSED,
      alignment: report as unknown as Record<string, any>,
      hudSignal: this.signalStore.encode(signal),
      signalSampleRate: signal.sampleRate,
    } as any);
  }
}
