import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { IVodClipper, VOD_CLIPPER_TOKEN } from '../../domain/interfaces/vod-clipper.interface';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IStartGGService, STARTGG_SERVICE_TOKEN } from '../../domain/services/startgg.service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { GameScreenEvent } from '../../domain/interfaces/game-screen-detector.interface';
import { CLIP_SET_QUEUE, CLIP_SET_JOB } from '../../infrastructure/queues/queue.constants';
import { ClipSetJobData } from '../../infrastructure/queues/clip-set.processor';

export interface ClipResult {
  setOrder: number;
  setStartGGId?: string;
  clipPath: string;
  startSeconds: number;
  endSeconds: number;
  fileSize: number;
}

export interface ClipVodResult {
  vodId: string;
  clips: ClipResult[];
}

@Injectable()
export class ClipVodUseCase {
  private readonly logger = new Logger(ClipVodUseCase.name);
  private readonly bufferSeconds = 15;

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(VOD_CLIPPER_TOKEN)
    private readonly clipper: IVodClipper,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject(STARTGG_SERVICE_TOKEN)
    private readonly startGGService: IStartGGService,
    @InjectQueue(CLIP_SET_QUEUE)
    private readonly queue: Queue,
  ) {}

  async getClipPlan(vodId: string): Promise<object> {
    const vod = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.events?.length) throw new Error(`VOD ${vodId} n'a pas encore été analysée`);

    const events = vod.events as unknown as GameScreenEvent[];
    const gamePairs = this.buildGamePairs(events);

    if (!vod.eventStartGGId) {
      return { vodId, gamePairs, message: 'Pas de eventStartGGId — mode single VOD' };
    }

    const sets = await this.startGGService.getStreamSetsByEventId(vod.eventStartGGId, vod.streamName);
    const canUseTimestamps = gamePairs.length > 0 && sets.length > 0 && !!(sets[0].startTime && sets[0].endTime);

    if (!canUseTimestamps) {
      return { vodId, canUseTimestamps: false, gamePairs, sets: sets.map(s => ({ id: s.id, roundName: s.roundName, startTime: s.startTime })) };
    }

    const t1 = new Date(sets[0].startTime!).getTime() / 1000;
    const v1 = gamePairs[0].start;
    const estimatedStreamStart = t1 - v1; // Unix timestamp estimé du début du stream

    const setVodStarts = sets.map((s) =>
      s.startTime ? v1 + (new Date(s.startTime).getTime() / 1000 - t1) : NaN,
    );

    const plan = [];
    let lastAssignedGameEnd = 0;

    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      const setVodStart = setVodStarts[i];
      const nextSetVodStart = i + 1 < sets.length ? setVodStarts[i + 1] : Infinity;
      // totalGames de Start.gg = format BO (5 pour BO5), pas les games joués — utiliser le score
      const gameCount = this.parseScoreTotal(set.score);

      if (isNaN(setVodStart)) {
        plan.push({ setOrder: i + 1, roundName: set.roundName, error: 'startTime manquant', skipped: true });
        continue;
      }
      if (gameCount <= 0) {
        plan.push({ setOrder: i + 1, roundName: set.roundName, score: set.score, error: `score invalide "${set.score}"`, skipped: true });
        continue;
      }

      let setGames = gamePairs.filter(
        (p) =>
          p.start >= setVodStart - 120 &&
          p.start < nextSetVodStart - 60 &&
          p.end < nextSetVodStart + 120,
      );

      let extendedSearch = false;
      if (setGames.length === 0) {
        const extended = gamePairs.filter(
          (p) =>
            p.start > lastAssignedGameEnd &&
            p.start < nextSetVodStart - 60 &&
            p.end < (nextSetVodStart === Infinity ? Infinity : nextSetVodStart + 120),
        );
        if (extended.length > 0) {
          setGames = extended;
          extendedSearch = true;
        }
      }

      // Gap pairs : pairs non-assignées AVANT la fenêtre standard
      const gapPairs = gamePairs.filter(
        (p) =>
          p.start > lastAssignedGameEnd &&
          p.start < setVodStart - 120 &&
          p.end < (nextSetVodStart === Infinity ? Infinity : nextSetVodStart + 120),
      );

      const allSetGames = [...gapPairs, ...setGames];
      if (allSetGames.length > 0) {
        lastAssignedGameEnd = allSetGames[allSetGames.length - 1].end;
      }

      const firstGameStart = allSetGames.length > 0 ? allSetGames[0].start : Infinity;
      const startSeconds = Math.max(0, Math.round(Math.min(firstGameStart, setVodStart) - this.bufferSeconds));

      let endSeconds: number;
      let fallback = false;
      if (setGames.length >= gameCount) {
        // OCR a trouvé tous les games
        if (setGames.length > gameCount && set.endTime) {
          // Plus de games que prévu : ancrer sur completedAt pour trouver le bon Nième
          // (évite de couper trop tôt quand des faux positifs précèdent les vrais games)
          const tEnd = new Date(set.endTime!).getTime() / 1000;
          const completedAtVod = v1 + (tEnd - t1);
          const gamesBeforeEnd = setGames.filter((p) => p.end <= completedAtVod + 300);
          if (gamesBeforeEnd.length >= gameCount) {
            const selected = gamesBeforeEnd.slice(-gameCount);
            endSeconds = selected[selected.length - 1].end + this.bufferSeconds;
          } else {
            endSeconds = setGames[gameCount - 1].end + this.bufferSeconds;
          }
        } else {
          endSeconds = setGames[gameCount - 1].end + this.bufferSeconds;
        }
      } else if (allSetGames.length > 0) {
        // OCR a trouvé des games mais pas tous : lastOcrEnd plus fiable que completedAt
        // (le TO peut enregistrer le score des minutes après la fin réelle)
        // MAIS si lastOcrEnd dépasse completedAt de plus de 5 min, le dernier game OCR appartient
        // probablement au set suivant → on cap sur completedAt
        fallback = true;
        const tEnd = new Date(set.endTime!).getTime() / 1000;
        const completedAtVod = Math.round(v1 + (tEnd - t1) + this.bufferSeconds);
        const lastOcrEnd = Math.round(allSetGames[allSetGames.length - 1].end + this.bufferSeconds);
        // Si lastOcrEnd s'éloigne de plus de 5 min de completedAt (dans un sens ou l'autre),
        // c'est suspect : soit OCR a dépassé sur le set suivant (+300), soit OCR a raté
        // le dernier game (-300). Dans les deux cas, completedAt est plus fiable.
        const rawEnd = (lastOcrEnd > completedAtVod + 300 || lastOcrEnd < completedAtVod - 300)
          ? completedAtVod
          : lastOcrEnd;
        // Cap souple : on ne coupe pas si le dernier game déborde du prochain set (stream en retard)
        const softCap = nextSetVodStart < Infinity ? Math.round(nextSetVodStart + 120) : Infinity;
        endSeconds = Math.min(rawEnd, softCap);
      } else {
        // Aucun game trouvé : fallback completedAt
        fallback = true;
        const tEnd = new Date(set.endTime!).getTime() / 1000;
        const completedAtVod = Math.round(v1 + (tEnd - t1) + this.bufferSeconds);
        endSeconds = nextSetVodStart < Infinity
          ? Math.min(completedAtVod, Math.round(nextSetVodStart - 30))
          : completedAtVod;
      }

      plan.push({
        setOrder: i + 1,
        roundName: set.roundName,
        players: `${set.player1.name} vs ${set.player2.name}`,
        score: set.score,
        gameCount,
        gamesFoundInWindow: setGames.length,
        gapPairsFound: gapPairs.length,
        extendedSearch,
        setVodStart: Math.round(setVodStart),
        windowMin: Math.round(setVodStart - 120),
        windowMax: nextSetVodStart < Infinity ? Math.round(nextSetVodStart - 60) : null,
        gamesInWindow: setGames.map(g => ({ start: Math.round(g.start), end: Math.round(g.end) })),
        gapPairs: gapPairs.map(g => ({ start: Math.round(g.start), end: Math.round(g.end) })),
        startSeconds,
        endSeconds: Math.round(endSeconds),
        durationMin: Math.round((endSeconds - startSeconds) / 60),
        fallbackToCompletedAt: fallback,
        startGGStartTime: set.startTime,
        startGGEndTime: set.endTime,
      });
    }

    return {
      vodId,
      anchor: { t1_startGG: t1, v1_vodOffset: v1, estimatedStreamStart },
      totalGamePairs: gamePairs.length,
      gamePairs: gamePairs.map(g => ({ start: Math.round(g.start), end: Math.round(g.end) })),
      totalSets: sets.length,
      plan,
    };
  }

  async execute(vodId: string): Promise<ClipVodResult> {
    const vod = await this.vodRepository.findById(vodId);
    if (!vod) throw new NotFoundException(`VOD non trouvée: ${vodId}`);
    if (!vod.filePath) throw new NotFoundException(`VOD ${vodId} n'a pas de fichier local`);
    if (!vod.events?.length) {
      throw new Error(`VOD ${vodId} n'a pas encore été analysée (events manquants)`);
    }

    const clipsDir = path.join(process.cwd(), 'storage', 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });

    const events = vod.events as unknown as GameScreenEvent[];
    const gamePairs = this.buildGamePairs(events);

    this.logger.log(`🎮 ${gamePairs.length} games détectés pour VOD ${vodId}`);

    // Cas multi-sets via Start.gg
    if (vod.eventStartGGId) {
      return this.clipByStartGGSets(vod, gamePairs, clipsDir);
    }

    // Cas simple : 1 clip pour toute la VOD
    return this.clipSingleVod(vod, gamePairs, clipsDir);
  }

  private async clipByStartGGSets(
    vod: any,
    gamePairs: { start: number; end: number }[],
    clipsDir: string,
  ): Promise<ClipVodResult> {
    const sets = await this.startGGService.getStreamSetsByEventId(
      vod.eventStartGGId,
      vod.streamName,
    );

    this.logger.log(`📋 ${sets.length} sets trouvés sur Start.gg pour l'event ${vod.eventStartGGId}`);

    const jobs: ClipSetJobData[] = [];

    const canUseTimestamps = gamePairs.length > 0 && sets.length > 0 && !!(sets[0].startTime && sets[0].endTime);
    const setsWithTimestamps = canUseTimestamps ? sets.filter((s) => s.startTime && s.endTime).length : 0;
    this.logger.log(`🕐 Timestamps: ${setsWithTimestamps}/${sets.length} sets — canUseTimestamps=${canUseTimestamps}`);

    if (canUseTimestamps) {
      // Ancre : sets[0].startTime ↔ gamePairs[0].start (premier écran de jeu détecté)
      const t1 = new Date(sets[0].startTime!).getTime() / 1000;
      const v1 = gamePairs[0].start;
      this.logger.log(`⏱️ Ancre: StartGG t0=${sets[0].startTime}, VOD v0=${v1}s`);

      // VOD start estimé pour chaque set (depuis startedAt, NaN si absent)
      const setVodStarts = sets.map((s) =>
        s.startTime ? v1 + (new Date(s.startTime).getTime() / 1000 - t1) : NaN,
      );

      let lastAssignedGameEnd = 0;

      for (let i = 0; i < sets.length; i++) {
        const set = sets[i];
        const setVodStart = setVodStarts[i];
        const nextSetVodStart = i + 1 < sets.length ? setVodStarts[i + 1] : Infinity;
        // totalGames de Start.gg = format BO (5 pour BO5), pas les games joués — utiliser le score
        const gameCount = this.parseScoreTotal(set.score);

        if (gameCount <= 0) {
          this.logger.warn(`Set ${i + 1} (${set.roundName}): score invalide "${set.score}", skip`);
          continue;
        }

        if (isNaN(setVodStart)) {
          this.logger.warn(`Set ${i + 1} (${set.roundName}): startTime manquant dans l'API, skip`);
          continue;
        }

        // Fenêtre du set : [setVodStart-120, nextSetVodStart-60]
        // Exclure les paires dont l'END dépasse la frontière du prochain set (faux positifs mergés)
        let setGames = gamePairs.filter(
          (p) =>
            p.start >= setVodStart - 120 &&
            p.start < nextSetVodStart - 60 &&
            p.end < nextSetVodStart + 120,
        );

        // Si aucun game trouvé (ex: TO a cliqué "start" tard dans le bracket), chercher dans les
        // pairs non assignées après le dernier game du set précédent
        if (setGames.length === 0) {
          const extended = gamePairs.filter(
            (p) =>
              p.start > lastAssignedGameEnd &&
              p.start < nextSetVodStart - 60 &&
              p.end < (nextSetVodStart === Infinity ? Infinity : nextSetVodStart + 120),
          );
          if (extended.length > 0) {
            this.logger.warn(`Set ${i + 1}: fenêtre standard vide — extended search: ${extended.length} pairs trouvées`);
            setGames = extended;
          }
        }

        // Gap pairs : pairs non-assignées AVANT la fenêtre standard
        // (cas où le TO a cliqué "start" en retard — le game avait déjà commencé)
        const gapPairs = gamePairs.filter(
          (p) =>
            p.start > lastAssignedGameEnd &&
            p.start < setVodStart - 120 &&
            p.end < (nextSetVodStart === Infinity ? Infinity : nextSetVodStart + 120),
        );
        if (gapPairs.length > 0) {
          this.logger.warn(`Set ${i + 1}: ${gapPairs.length} gap pair(s) avant la fenêtre (start=${gapPairs[0].start}s)`);
        }

        const allSetGames = [...gapPairs, ...setGames];
        if (allSetGames.length > 0) {
          lastAssignedGameEnd = allSetGames[allSetGames.length - 1].end;
        }

        // START : ancre sur le premier game trouvé (gap pair inclus) ou setVodStart
        const firstGameStart = allSetGames.length > 0 ? allSetGames[0].start : Infinity;
        const startSeconds = Math.max(
          0,
          Math.round(Math.min(firstGameStart, setVodStart) - this.bufferSeconds),
        );

        let endSeconds: number;
        if (setGames.length >= gameCount) {
          // OCR a détecté tous les games
          if (setGames.length > gameCount && set.endTime) {
            // Plus de games que prévu : ancrer sur completedAt pour trouver le bon Nième
            const tEnd = new Date(set.endTime!).getTime() / 1000;
            const completedAtVod = v1 + (tEnd - t1);
            const gamesBeforeEnd = setGames.filter((p) => p.end <= completedAtVod + 300);
            if (gamesBeforeEnd.length >= gameCount) {
              const selected = gamesBeforeEnd.slice(-gameCount);
              endSeconds = selected[selected.length - 1].end + this.bufferSeconds;
              this.logger.log(
                `Set ${i + 1}: ${setGames.length} games > ${gameCount} attendus — ancré sur completedAt(${Math.round(completedAtVod)}s) → game ${selected[selected.length - 1].start}s→${selected[selected.length - 1].end}s`,
              );
            } else {
              endSeconds = setGames[gameCount - 1].end + this.bufferSeconds;
            }
          } else {
            endSeconds = setGames[gameCount - 1].end + this.bufferSeconds;
          }
        } else if (allSetGames.length > 0) {
          // OCR a trouvé des games mais pas tous : lastOcrEnd plus fiable que completedAt
          // MAIS si lastOcrEnd dépasse completedAt de plus de 5 min → le dernier game OCR est hors-set
          const tEndClip = new Date(set.endTime!).getTime() / 1000;
          const completedAtVodClip = Math.round(v1 + (tEndClip - t1) + this.bufferSeconds);
          const lastOcrEnd = Math.round(allSetGames[allSetGames.length - 1].end + this.bufferSeconds);
          const rawEnd = (lastOcrEnd > completedAtVodClip + 300 || lastOcrEnd < completedAtVodClip - 300)
            ? completedAtVodClip
            : lastOcrEnd;
          // Cap souple : on tolère un débordement de 2 min sur le prochain set (stream en retard)
          const softCap = nextSetVodStart < Infinity ? Math.round(nextSetVodStart + 120) : Infinity;
          endSeconds = Math.min(rawEnd, softCap);
          this.logger.warn(
            `Set ${i + 1}: ${setGames.length}/${gameCount} games OCR — fin sur ${rawEnd === completedAtVodClip ? 'completedAt(cap)' : 'lastOcrEnd'} → ${endSeconds}s`,
          );
        } else {
          // Aucun game trouvé par OCR : fallback sur completedAt (capé par le début du prochain set)
          const tEnd = new Date(set.endTime!).getTime() / 1000;
          const completedAtVod = Math.round(v1 + (tEnd - t1) + this.bufferSeconds);
          endSeconds =
            nextSetVodStart < Infinity
              ? Math.min(completedAtVod, Math.round(nextSetVodStart - 30))
              : completedAtVod;
          this.logger.warn(
            `Set ${i + 1}: 0 games OCR — fallback completedAt → ${endSeconds}s`,
          );
        }

        this.logger.log(
          `✂️ Set ${i + 1} (${set.roundName}): ${setGames.length}/${gameCount} games, [${startSeconds}s → ${endSeconds}s] (${Math.round((endSeconds - startSeconds) / 60)}min)`,
        );

        jobs.push({
          vodId: vod.id,
          setOrder: i + 1,
          setStartGGId: set.id,
          inputPath: vod.filePath,
          outputPath: path.join(clipsDir, `${vod.id}_set_${i + 1}.mp4`),
          startSeconds,
          endSeconds,
          totalSets: sets.length,
        });
      }
    } else {
      // Fallback : assignation séquentielle par game pairs OCR
      this.logger.warn(`⚠️ Timestamps Start.gg manquants — fallback séquentiel (${gamePairs.length} pairs)`);
      let gameIndex = 0;

      for (let i = 0; i < sets.length; i++) {
        const set = sets[i];
        const gameCount = this.parseScoreTotal(set.score);

        if (gameCount <= 0) {
          this.logger.warn(`Set ${set.id} (${set.roundName}): score invalide (${set.score}), skip`);
          continue;
        }

        const setGames = gamePairs.slice(gameIndex, gameIndex + gameCount);
        if (setGames.length === 0) {
          this.logger.warn(`Plus de games disponibles pour le set ${i + 1}, arrêt`);
          break;
        }

        this.logger.log(
          `✂️ Set ${i + 1} (${set.roundName}): ${gameCount} games, pairs [${gameIndex}-${gameIndex + gameCount - 1}], ${setGames[0].start}s → ${setGames[setGames.length - 1].end}s`,
        );
        gameIndex += gameCount;

        jobs.push({
          vodId: vod.id,
          setOrder: i + 1,
          setStartGGId: set.id,
          inputPath: vod.filePath,
          outputPath: path.join(clipsDir, `${vod.id}_set_${i + 1}.mp4`),
          startSeconds: Math.max(0, setGames[0].start - this.bufferSeconds),
          endSeconds: setGames[setGames.length - 1].end + this.bufferSeconds,
          totalSets: sets.length,
        });
      }
    }

    await this.vodRepository.update(vod.id, { status: VodStatus.PROCESSING });

    // Publier tous les jobs en parallèle
    await Promise.all(
      jobs.map((data) => this.queue.add(CLIP_SET_JOB, data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }))
    );
    this.logger.log(`🚀 ${jobs.length} jobs clip-set publiés pour VOD ${vod.id}`);

    return {
      vodId: vod.id,
      clips: jobs.map((j) => ({
        setOrder: j.setOrder,
        setStartGGId: j.setStartGGId,
        clipPath: j.outputPath,
        startSeconds: j.startSeconds,
        endSeconds: j.endSeconds,
        fileSize: 0, // sera rempli par le worker
      })),
    };
  }

  private async clipSingleVod(
    vod: any,
    _gamePairs: { start: number; end: number }[],
    clipsDir: string,
  ): Promise<ClipVodResult> {
    if (vod.startTime == null || vod.endTime == null) {
      throw new Error(`VOD ${vod.id} n'a pas encore été analysée (startTime/endTime manquants)`);
    }

    const startSeconds = Math.max(0, vod.startTime - this.bufferSeconds);
    const endSeconds = vod.endTime + this.bufferSeconds;
    const outputPath = path.join(clipsDir, `${vod.id}.mp4`);

    this.logger.log(`✂️ VOD ${vod.id}: clip unique [${startSeconds}s → ${endSeconds}s]`);

    const result = await this.clipper.clip({
      inputPath: vod.filePath,
      outputPath,
      startSeconds,
      endSeconds,
    });

    await this.clipRepository.create({
      vodId: vod.id,
      setOrder: 1,
      filePath: result.outputPath,
      startSeconds,
      endSeconds,
      status: 'PENDING',
    });

    await this.vodRepository.update(vod.id, {
      processedUrl: result.outputPath,
      status: VodStatus.COMPLETED,
    });

    return {
      vodId: vod.id,
      clips: [{ setOrder: 1, clipPath: result.outputPath, startSeconds, endSeconds, fileSize: result.fileSize }],
    };
  }

  // Durée minimum d'une game valide (filtre les faux positifs OCR < 90s)
  private readonly minGamePairDuration = 90;

  private buildGamePairs(events: GameScreenEvent[]): { start: number; end: number }[] {
    const pairs: { start: number; end: number }[] = [];
    let currentStart: number | null = null;

    for (const event of events) {
      if (event.type === 'START' && currentStart === null) {
        currentStart = event.timestamp;
      } else if (event.type === 'END' && currentStart !== null) {
        const duration = event.timestamp - currentStart;
        if (duration >= this.minGamePairDuration) {
          pairs.push({ start: currentStart, end: event.timestamp });
        } else {
          this.logger.debug(`🗑️ Faux positif filtré: ${Math.round(currentStart)}s→${Math.round(event.timestamp)}s (${Math.round(duration)}s < ${this.minGamePairDuration}s)`);
        }
        currentStart = null;
      }
    }

    return pairs;
  }

  private parseScoreTotal(score: string): number {
    const parts = score.split(' - ');
    if (parts.length < 2) return 0;
    const s1 = parts[0].match(/(\d+)$/)?.[1];
    const s2 = parts[parts.length - 1].match(/(\d+)$/)?.[1];
    if (s1 && s2) return parseInt(s1) + parseInt(s2);
    return 0;
  }
}
