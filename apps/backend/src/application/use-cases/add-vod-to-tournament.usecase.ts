import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { ISetRepository, SET_REPOSITORY_TOKEN } from '../../domain/repositories/set.repository.interface';
import { IVodDownloadService, VOD_DOWNLOAD_SERVICE_TOKEN } from '../../domain/interfaces/vod-download-service.interface';
import { VodStatus } from '../../domain/entities/vod.entity';

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
    @Inject(VOD_DOWNLOAD_SERVICE_TOKEN)
    private readonly downloadService: IVodDownloadService,
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

    // 2. Valider l'URL (YouTube ou Twitch)
    if (!this.isValidUrl(sourceUrl)) {
      throw new Error('URL invalide. Doit être YouTube ou Twitch.');
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

    // 4. Lancer le téléchargement (async, ne bloque pas la réponse)
    this.downloadVod(vod.id, sourceUrl).catch((err) => {
      this.logger.error(`❌ Erreur download VOD ${vod.id}: ${err.message}`);
      this.vodRepository.updateStatus(vod.id, VodStatus.FAILED);
    });

    return {
      id: vod.id,
      setId: vod.setId,
      eventStartGGId: vod.eventStartGGId,
      sourceUrl: vod.sourceUrl,
      status: VodStatus.DOWNLOADING,
      message: 'VOD créée. Téléchargement en cours...',
    };
  }

  private isValidUrl(url: string): boolean {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    const twitchRegex = /^(https?:\/\/)?(www\.)?(twitch\.tv)\/.+/;
    return youtubeRegex.test(url) || twitchRegex.test(url);
  }

  private detectSource(url: string): 'youtube' | 'twitch' | 'unknown' {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'youtube';
    }
    if (url.includes('twitch.tv')) {
      return 'twitch';
    }
    return 'unknown';
  }

  private async downloadVod(vodId: string, sourceUrl: string): Promise<void> {
    this.logger.log(`⬇️ Démarrage téléchargement VOD ${vodId}`);

    const result = await this.downloadService.download(
      sourceUrl,
      undefined, // Utilise le chemin par défaut
      (progress) => {
        if (progress.percent % 10 === 0) { // Log tous les 10%
          this.logger.log(`📥 VOD ${vodId}: ${progress.percent.toFixed(0)}% (${progress.speed})`);
        }
      }
    );

    // Mettre à jour la VOD avec le fichier téléchargé
    await this.vodRepository.update(vodId, {
      filePath: result.filePath,
      status: VodStatus.DOWNLOADED,
      fileSize: result.fileSize,
      duration: result.duration,
      resolution: result.resolution,
    });

    this.logger.log(`✅ VOD ${vodId} téléchargée: ${result.filePath}`);
  }
}
