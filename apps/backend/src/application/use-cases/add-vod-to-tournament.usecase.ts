import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { ISetRepository, SET_REPOSITORY_TOKEN } from '../../domain/repositories/set.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';
import { VOD_DOWNLOAD_QUEUE, VOD_DOWNLOAD_JOB } from '../../infrastructure/queues/queue.constants';

export interface AddVodToTournamentInput {
  setId?: string;
  eventStartGGId?: string;
  streamName?: string;
  tournamentId?: string;
  sourceUrl: string;
  metadata?: Record<string, any>;
}

export interface AddVodToTournamentResult {
  id: string;
  setId?: string;
  eventStartGGId?: string;
  sourceUrl: string;
  status: VodStatus;
  message: string;
}

@Injectable()
export class AddVodToTournamentUseCase {
  private readonly logger = new Logger(AddVodToTournamentUseCase.name);

  constructor(
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject(SET_REPOSITORY_TOKEN)
    private readonly setRepository: ISetRepository,
    @InjectQueue(VOD_DOWNLOAD_QUEUE)
    private readonly downloadQueue: Queue,
  ) {}

  async execute(input: AddVodToTournamentInput): Promise<AddVodToTournamentResult> {
    const { setId, eventStartGGId, streamName, tournamentId, sourceUrl, metadata } = input;

    if (!setId && !eventStartGGId && !tournamentId) {
      throw new Error('setId, eventStartGGId ou tournamentId requis');
    }

    this.logger.log(`🎬 Ajout VOD (set: ${setId ?? '-'}, event: ${eventStartGGId ?? '-'}): ${sourceUrl}`);

    // 1. Vérifier que le set existe si fourni
    if (setId) {
      const set = await this.setRepository.findById(setId);
      if (!set) throw new NotFoundException(`Set non trouvé: ${setId}`);
    }

    // 2. Détecter si chemin local ou URL distante
    if (this.isLocalPath(sourceUrl)) {
      if (!fs.existsSync(sourceUrl)) {
        throw new NotFoundException(`Fichier local non trouvé: ${sourceUrl}`);
      }
      const stats = fs.statSync(sourceUrl);
      const vod = await this.vodRepository.create({
        setId,
        eventStartGGId,
        streamName,
        tournamentId,
        sourceUrl,
        status: VodStatus.DOWNLOADED,
        filePath: sourceUrl,
        fileSize: Number(stats.size),
      } as any);
      this.logger.log(`✅ VOD locale enregistrée: ${vod.id} → ${sourceUrl}`);
      return {
        id: vod.id,
        setId: vod.setId,
        eventStartGGId: vod.eventStartGGId,
        sourceUrl: vod.sourceUrl,
        status: VodStatus.DOWNLOADED,
        message: 'VOD locale enregistrée avec succès.',
      };
    }

    if (!this.isValidUrl(sourceUrl)) {
      throw new Error('URL invalide. Doit être YouTube, Twitch, ou un chemin local absolu.');
    }

    // 3. Créer la VOD
    const vod = await this.vodRepository.create({
      setId,
      eventStartGGId,
      streamName,
      tournamentId,
      sourceUrl,
      status: VodStatus.DOWNLOADING,
      metadata: {
        ...metadata,
        source: this.detectSource(sourceUrl),
      },
    });

    this.logger.log(`✅ VOD créée: ${vod.id}`);

    // 4. Ajouter un job de téléchargement dans la queue BullMQ
    await this.downloadQueue.add(VOD_DOWNLOAD_JOB, { vodId: vod.id, sourceUrl }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
    });
    this.logger.log(`📋 Job download enqueued pour VOD ${vod.id}`);

    return {
      id: vod.id,
      setId: vod.setId,
      eventStartGGId: vod.eventStartGGId,
      sourceUrl: vod.sourceUrl,
      status: VodStatus.DOWNLOADING,
      message: 'VOD créée. Téléchargement en file d\'attente...',
    };
  }

  private isLocalPath(p: string): boolean {
    return p.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(p);
  }

  private isValidUrl(url: string): boolean {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    const twitchRegex = /^(https?:\/\/)?(www\.)?(twitch\.tv)\/.+/;
    return youtubeRegex.test(url) || twitchRegex.test(url);
  }

  private detectSource(url: string): 'youtube' | 'twitch' | 'unknown' {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('twitch.tv')) return 'twitch';
    return 'unknown';
  }
}
