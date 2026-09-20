import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  PlafondChaineAtteint,
  YouTubeService,
} from '../external-services/youtube.service';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';

/** Visibilités acceptées par l'API YouTube. */
const VISIBILITES = ['public', 'unlisted', 'private'] as const;

class UploadClipDto {
  title!: string;
  description!: string;
  privacyStatus!: (typeof VISIBILITES)[number];
}

@Controller()
export class YouTubeController {
  private readonly logger = new Logger(YouTubeController.name);

  constructor(
    private readonly youtubeService: YouTubeService,
    @Inject(CLIP_REPOSITORY_TOKEN)
    private readonly clipRepository: IClipRepository,
    @Inject(VOD_REPOSITORY_TOKEN)
    private readonly vodRepository: IVodRepository,
    @Inject('ITournamentRepository')
    private readonly tournamentRepository: ITournamentRepository,
  ) {}

  // ── Auth ──────────────────────────────────────────────────────────────

  @Get('youtube/auth-url')
  getAuthUrl() {
    try {
      const url = this.youtubeService.getAuthUrl();
      return { url };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Get('youtube/callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    if (!code) { res.status(400).send('Code manquant'); return; }
    try {
      await this.youtubeService.handleCallback(code);
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4200';
      res.redirect(`${frontendUrl}/youtube-connected`);
    } catch (err) {
      this.logger.error(`OAuth callback error: ${(err as Error).message}`);
      res.status(500).send(`Erreur OAuth: ${(err as Error).message}`);
    }
  }

  // ── Account management ───────────────────────────────────────────────

  @Get('youtube/accounts')
  async listAccounts() {
    return this.youtubeService.listAccounts();
  }

  @Delete('youtube/accounts/:id')
  async disconnectAccount(@Param('id') id: string) {
    await this.youtubeService.disconnectAccount(id);
    return { message: 'Compte déconnecté' };
  }

  // ── Playlist ─────────────────────────────────────────────────────────

  @Post('tournaments/:id/playlist')
  async ensurePlaylist(
    @Param('id') id: string,
    @Body() body: { privacyStatus?: string; description?: string },
  ) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundException(`Tournoi ${id} non trouvé`);

    if (tournament.youtubePlaylistId) {
      return { playlistId: tournament.youtubePlaylistId, created: false };
    }

    const accounts = await this.youtubeService.listAccounts();
    if (accounts.length === 0) {
      throw new BadRequestException('Aucune chaîne YouTube connectée.');
    }
    const youtubeAccountId = accounts[0].id;

    const playlistId = await this.youtubeService.createPlaylist(
      tournament.name,
      youtubeAccountId,
      { privacyStatus: body.privacyStatus, description: body.description ?? '' },
    );
    await this.tournamentRepository.update(id, { youtubePlaylistId: playlistId });

    return { playlistId, created: true };
  }

  /** Renomme la playlist du tournoi, ou change sa description et sa visibilité. */
  @Patch('tournaments/:id/playlist')
  async renamePlaylist(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; privacyStatus?: string },
  ) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundException(`Tournoi ${id} non trouvé`);
    if (!tournament.youtubePlaylistId) {
      throw new BadRequestException(
        'Ce tournoi ne possède pas encore de playlist.',
      );
    }

    const comptes = await this.youtubeService.listAccounts();
    if (comptes.length === 0) {
      throw new BadRequestException('Aucune chaîne YouTube connectée.');
    }

    await this.youtubeService.updatePlaylist(
      tournament.youtubePlaylistId,
      comptes[0].id,
      body,
    );
    return { playlistId: tournament.youtubePlaylistId, updated: true };
  }

  /**
   * Ajoute à la playlist les clips déjà en ligne qui n'y sont pas.
   *
   * L'ajout à la playlist peut échouer alors que l'envoi a réussi : la vidéo
   * existe, mais hors de la playlist. Cette route rattrape ces cas sans rien
   * réenvoyer, donc sans consommer le quota d'upload.
   */
  @Post('tournaments/:id/playlist/sync')
  async syncPlaylist(@Param('id') id: string) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundException(`Tournoi ${id} non trouvé`);
    if (!tournament.youtubePlaylistId) {
      throw new BadRequestException(
        'Ce tournoi ne possède pas encore de playlist.',
      );
    }

    const comptes = await this.youtubeService.listAccounts();
    if (comptes.length === 0) {
      throw new BadRequestException('Aucune chaîne YouTube connectée.');
    }
    const compteId = comptes[0].id;

    const dejaLa = await this.youtubeService.listPlaylistVideoIds(
      tournament.youtubePlaylistId,
      compteId,
    );

    const vods = await this.vodRepository.findByTournamentId(id);
    const ajoutes: string[] = [];
    const echecs: Array<{ videoId: string; raison: string }> = [];

    for (const vod of vods) {
      const clips = await this.clipRepository.findByVodId(vod.id);
      for (const clip of clips) {
        const videoId = clip.youtubeVideoId;
        if (!videoId || dejaLa.has(videoId)) continue;
        try {
          await this.youtubeService.addToPlaylist(
            tournament.youtubePlaylistId,
            videoId,
            compteId,
          );
          ajoutes.push(videoId);
        } catch (err) {
          echecs.push({ videoId, raison: (err as Error).message });
        }
      }
    }

    return {
      playlistId: tournament.youtubePlaylistId,
      dejaPresentes: dejaLa.size,
      ajoutes: ajoutes.length,
      echecs,
    };
  }

  // ── Upload ───────────────────────────────────────────────────────────

  /**
   * Envoie un clip sur YouTube.
   *
   * Le titre, la description et la visibilité sont exigés explicitement. Ils
   * ont des valeurs par défaut côté interface, mais l'appel ne doit pas pouvoir
   * s'en passer : une vidéo publiée sous un titre ou une visibilité qu'on n'a
   * pas choisis se rattrape mal, et c'est précisément ce qui est arrivé à la
   * première playlist, créée publique parce que personne n'avait tranché.
   */
  @Post('clips/:id/upload-youtube')
  async uploadClip(
    @Param('id') id: string,
    @Body() body: UploadClipDto,
  ) {
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);
    if (!clip.filePath) throw new BadRequestException('Clip sans fichier');

    const titre = (body?.title ?? '').trim();
    if (!titre) {
      throw new BadRequestException(
        'Le titre est obligatoire. Passe par le formulaire avant d envoyer.',
      );
    }
    if (body?.description == null) {
      throw new BadRequestException(
        'La description est obligatoire, même vide. Passe par le formulaire avant d envoyer.',
      );
    }
    if (!VISIBILITES.includes(body?.privacyStatus as any)) {
      throw new BadRequestException(
        `La visibilité doit valoir ${VISIBILITES.join(', ')}.`,
      );
    }
    if (clip.status === 'UPLOADING') throw new BadRequestException('Upload déjà en cours');
    if (clip.status === 'UPLOADED') return { youtubeVideoId: clip.youtubeVideoId, alreadyUploaded: true };

    // Use the first connected YouTube account
    const accounts = await this.youtubeService.listAccounts();
    if (accounts.length === 0) {
      throw new BadRequestException('Aucune chaîne YouTube connectée. Connecte-en une depuis la page d\'accueil.');
    }
    const youtubeAccountId = accounts[0].id;

    // Load tournament for playlist creation
    const vod = await this.vodRepository.findById(clip.vodId);
    const tournament = vod?.tournamentId
      ? await this.tournamentRepository.findById(vod.tournamentId)
      : null;

    // Les choix sont enregistrés avant l'envoi : ils deviennent l'état du clip,
    // et non un paramètre de passage oublié aussitôt.
    await this.clipRepository.update(id, {
      title: titre,
      description: body.description,
      privacyStatus: body.privacyStatus,
      status: 'UPLOADING',
    });
    const clipAJour = {
      ...clip,
      title: titre,
      description: body.description,
      privacyStatus: body.privacyStatus,
    };

    this.runUpload(id, clipAJour, youtubeAccountId, tournament).catch((err) => {
      this.logger.error(`Upload background error: ${err}`);
    });

    return { message: 'Upload en cours...' };
  }

  private async runUpload(clipId: string, clip: any, youtubeAccountId: string, tournament: any) {
    // Aucun repli ici : le contrôleur a exigé et enregistré ces valeurs. Un
    // repli réécrirait une description que l'on a volontairement laissée vide.
    const title = clip.title;
    const description = clip.description ?? '';

    try {
      const videoId = await this.youtubeService.uploadVideo({
        filePath: clip.filePath,
        title,
        description,
        thumbnailPath: clip.thumbnailPath,
        privacyStatus: (clip.privacyStatus ?? 'unlisted') as any,
        youtubeAccountId,
      });

      await this.clipRepository.update(clipId, { status: 'UPLOADED', youtubeVideoId: videoId });
      this.logger.log(`✅ Clip ${clipId} uploadé → https://youtu.be/${videoId}`);

      await this.addToTournamentPlaylist(tournament, videoId, youtubeAccountId);
    } catch (err) {
      // Le plafond de la chaine n est pas un echec du clip : il est intact et
      // renvoyable tel quel demain. Le marquer FAILED laissait croire a douze
      // clips casses alors que rien ne clochait chez eux.
      if (err instanceof PlafondChaineAtteint) {
        this.logger.warn(
          `⏸ Upload clip ${clipId} repousse : ${err.message}`,
        );
        await this.clipRepository.update(clipId, { status: 'APPROVED' });
        return;
      }
      this.logger.error(`❌ Upload clip ${clipId} échoué: ${(err as Error).message}`);
      await this.clipRepository.update(clipId, { status: 'FAILED' });
    }
  }

  private async addToTournamentPlaylist(tournament: any, videoId: string, youtubeAccountId: string): Promise<void> {
    try {
      // Re-fetch tournament to avoid race condition when multiple clips upload in parallel
      const fresh = await this.tournamentRepository.findById(tournament.id);
      let playlistId = fresh?.youtubePlaylistId;
      if (!playlistId) {
        playlistId = await this.youtubeService.createPlaylist(tournament.name, youtubeAccountId);
        await this.tournamentRepository.update(tournament.id, { youtubePlaylistId: playlistId });
      }
      await this.youtubeService.addToPlaylist(playlistId, videoId, youtubeAccountId);
    } catch (err) {
      // Ne pas masquer : la vidéo est en ligne mais absente de la playlist, et
      // c'est invisible sans ce message. POST .../playlist/sync rattrape le cas.
      this.logger.error(
        `❌ Ajout à la playlist échoué pour ${videoId} : ${(err as Error).message}. ` +
          `Utilise POST /api/tournaments/${tournament?.id}/playlist/sync pour rattraper.`,
      );
    }
  }
}
