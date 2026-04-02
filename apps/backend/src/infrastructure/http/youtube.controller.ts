import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { YouTubeService } from '../external-services/youtube.service';
import { IClipRepository, CLIP_REPOSITORY_TOKEN } from '../../domain/repositories/clip.repository.interface';
import { IVodRepository, VOD_REPOSITORY_TOKEN } from '../../domain/repositories/vod.repository.interface';
import { ITournamentRepository } from '../../domain/repositories/tournament.repository.interface';

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

  // ── Tournament ↔ account association ────────────────────────────────

  @Patch('tournaments/:id/youtube-account')
  async setTournamentAccount(
    @Param('id') id: string,
    @Query('accountId') accountId: string,
  ) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundException(`Tournoi ${id} non trouvé`);
    await this.tournamentRepository.update(id, { youtubeAccountId: accountId || null } as any);
    return { message: 'Compte YouTube associé au tournoi' };
  }

  // ── Upload ───────────────────────────────────────────────────────────

  @Post('clips/:id/upload-youtube')
  async uploadClip(@Param('id') id: string) {
    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);
    if (!clip.filePath) throw new BadRequestException('Clip sans fichier');
    if (clip.status === 'UPLOADING') throw new BadRequestException('Upload déjà en cours');
    if (clip.status === 'UPLOADED') return { youtubeVideoId: clip.youtubeVideoId, alreadyUploaded: true };

    // Find YouTube account via VOD → tournament
    const vod = await this.vodRepository.findById(clip.vodId);
    if (!vod?.tournamentId) throw new BadRequestException('VOD non associée à un tournoi');
    const tournament = await this.tournamentRepository.findById(vod.tournamentId);
    if (!tournament) throw new NotFoundException('Tournoi introuvable');

    const youtubeAccountId = (tournament as any).youtubeAccountId;
    if (!youtubeAccountId) {
      throw new BadRequestException(
        'Aucune chaîne YouTube associée à ce tournoi. Connecte un compte dans les paramètres du tournoi.',
      );
    }

    await this.clipRepository.update(id, { status: 'UPLOADING' });
    this.runUpload(id, clip, youtubeAccountId, tournament).catch((err) => {
      this.logger.error(`Upload background error: ${err}`);
    });

    return { message: 'Upload en cours...' };
  }

  private async runUpload(clipId: string, clip: any, youtubeAccountId: string, tournament: any) {
    const title = clip.title ?? clip.roundName ?? `Set ${clip.setOrder}`;
    let description = clip.description ?? '';
    if (!description) {
      const parts: string[] = [];
      if (clip.roundName) parts.push(clip.roundName);
      if (clip.players) parts.push(clip.players);
      if (clip.score) parts.push(`Score : ${clip.score}`);
      description = parts.join('\n');
    }

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
      this.logger.error(`❌ Upload clip ${clipId} échoué: ${(err as Error).message}`);
      await this.clipRepository.update(clipId, { status: 'FAILED' });
    }
  }

  private async addToTournamentPlaylist(tournament: any, videoId: string, youtubeAccountId: string): Promise<void> {
    try {
      let playlistId = tournament.youtubePlaylistId;
      if (!playlistId) {
        playlistId = await this.youtubeService.createPlaylist(tournament.name, youtubeAccountId);
        await this.tournamentRepository.update(tournament.id, { youtubePlaylistId: playlistId });
      }
      await this.youtubeService.addToPlaylist(playlistId, videoId, youtubeAccountId);
    } catch (err) {
      this.logger.warn(`Playlist add failed: ${(err as Error).message}`);
    }
  }
}
