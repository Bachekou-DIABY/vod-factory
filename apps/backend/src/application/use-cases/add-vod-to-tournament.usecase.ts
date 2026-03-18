import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { ISetRepository, SET_REPOSITORY_TOKEN } from '../../domain/repositories/set.repository.interface';
import { VodStatus } from '../../domain/entities/vod.entity';

export interface AddVodToTournamentInput {
  setId: string;
  sourceUrl: string;
  metadata?: Record<string, any>;
}

export interface AddVodToTournamentResult {
  id: string;
  setId: string;
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
    private readonly setRepository: ISetRepository
  ) {}

  async execute(input: AddVodToTournamentInput): Promise<AddVodToTournamentResult> {
    const { setId, sourceUrl, metadata } = input;

    this.logger.log(`🎬 Ajout VOD au set ${setId}: ${sourceUrl}`);

    // 1. Vérifier que le set existe
    const set = await this.setRepository.findById(setId);
    if (!set) {
      throw new NotFoundException(`Set non trouvé: ${setId}`);
    }

    // 2. Valider l'URL (YouTube ou Twitch)
    if (!this.isValidUrl(sourceUrl)) {
      throw new Error('URL invalide. Doit être YouTube ou Twitch.');
    }

    // 3. Créer la VOD
    const vod = await this.vodRepository.create({
      setId,
      sourceUrl,
      status: VodStatus.PENDING,
      metadata: {
        ...metadata,
        source: this.detectSource(sourceUrl),
      },
    });

    this.logger.log(`✅ VOD créée: ${vod.id}`);

    return {
      id: vod.id,
      setId: vod.setId,
      sourceUrl: vod.sourceUrl,
      status: vod.status,
      message: 'VOD ajoutée avec succès. Prête pour le téléchargement.',
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
}
