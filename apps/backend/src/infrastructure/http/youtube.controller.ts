import {
  Controller,
  Get,
  Post,
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

  @Get('youtube/auth-url')
  getAuthUrl() {
    try {
      const url = this.youtubeService.getAuthUrl();
      return { url, authenticated: this.youtubeService.isAuthenticated() };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Get('youtube/status')
  getStatus() {
    return { authenticated: this.youtubeService.isAuthenticated() };
  }

  @Get('youtube/callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    if (!code) {
      res.status(400).send('Code manquant');
      return;
    }
    try {
      await this.youtubeService.handleCallback(code);
      // Redirect to frontend approved page
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4200';
      res.redirect(`${frontendUrl}/youtube-connected`);
    } catch (err) {
      this.logger.error(`OAuth callback error: ${(err as Error).message}`);
      res.status(500).send(`Erreur OAuth: ${(err as Error).message}`);
    }
  }

  @Post('clips/:id/upload-youtube')
  async uploadClip(@Param('id') id: string) {
    if (!this.youtubeService.isAuthenticated()) {
      throw new BadRequestException('Non authentifié YouTube — appelle GET /api/youtube/auth-url d\'abord');
    }

    const clip = await this.clipRepository.findById(id);
    if (!clip) throw new NotFoundException(`Clip ${id} non trouvé`);
    if (!clip.filePath) throw new BadRequestException('Clip sans fichier');

    if (clip.status === 'UPLOADING') {
      throw new BadRequestException('Upload déjà en cours');
    }
    if (clip.status === 'UPLOADED') {
      return { youtubeVideoId: clip.youtubeVideoId, alreadyUploaded: true };
    }

    // Mark as uploading
    await this.clipRepository.update(id, { status: 'UPLOADING' });

    // Run upload in background
    this.runUpload(id, clip).catch(() => {});

    return { message: 'Upload en cours...' };
  }

  private async runUpload(clipId: string, clip: any) {
    const title = clip.title ?? clip.roundName ?? `Set ${clip.setOrder}`;
    let description = clip.description ?? '';
    if (!description) {
      const descParts: string[] = [];
      if (clip.roundName) descParts.push(clip.roundName);
      if (clip.players) descParts.push(clip.players);
      if (clip.score) descParts.push(`Score : ${clip.score}`);
      description = descParts.join('\n');
    }

    try {
      const videoId = await this.youtubeService.uploadVideo({
        filePath: clip.filePath,
        title,
        description,
        thumbnailPath: clip.thumbnailPath,
        privacyStatus: (clip.privacyStatus ?? 'unlisted') as 'public' | 'unlisted' | 'private',
      });

      await this.clipRepository.update(clipId, {
        status: 'UPLOADED',
        youtubeVideoId: videoId,
      });

      this.logger.log(`✅ Clip ${clipId} uploadé → https://youtu.be/${videoId}`);

      // Add to tournament playlist
      await this.addToTournamentPlaylist(clip, videoId);
    } catch (err) {
      this.logger.error(`❌ Upload clip ${clipId} échoué: ${(err as Error).message}`);
      await this.clipRepository.update(clipId, { status: 'FAILED' });
    }
  }

  private async addToTournamentPlaylist(clip: any, videoId: string): Promise<void> {
    try {
      const vod = await this.vodRepository.findById(clip.vodId);
      if (!vod?.tournamentId) return;

      const tournament = await this.tournamentRepository.findById(vod.tournamentId);
      if (!tournament) return;

      let playlistId = tournament.youtubePlaylistId;
      if (!playlistId) {
        playlistId = await this.youtubeService.createPlaylist(tournament.name);
        await this.tournamentRepository.update(tournament.id, { youtubePlaylistId: playlistId });
      }

      await this.youtubeService.addToPlaylist(playlistId, videoId);
    } catch (err) {
      // Playlist failure should not fail the upload
      this.logger.warn(`Playlist add failed: ${(err as Error).message}`);
    }
  }
}
