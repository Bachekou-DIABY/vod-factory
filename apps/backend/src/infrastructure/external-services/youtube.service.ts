import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../persistence/prisma.service';

const REDIRECT_URI = process.env.BACKEND_URL
  ? `${process.env.BACKEND_URL}/api/youtube/callback`
  : 'http://localhost:3000/api/youtube/callback';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);

  constructor(private readonly prisma: PrismaService) {}

  private newOAuthClient(): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis dans .env');
    }
    return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  }

  getAuthUrl(state?: string): string {
    const client = this.newOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      ...(state ? { state } : {}),
    });
  }

  async handleCallback(code: string): Promise<{ channelId: string; channelName: string }> {
    const client = this.newOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get channel info
    const yt = google.youtube({ version: 'v3', auth: client });
    const channelRes = await yt.channels.list({ part: ['snippet'], mine: true });
    const channel = channelRes.data.items?.[0];
    if (!channel) throw new Error('Impossible de récupérer les infos de la chaîne');

    const channelId = channel.id!;
    const channelName = channel.snippet?.title ?? channelId;

    // Upsert account in DB
    await this.prisma.youtubeAccount.upsert({
      where: { channelId },
      create: { channelId, channelName, tokens: tokens as any },
      update: { channelName, tokens: tokens as any },
    });

    this.logger.log(`✅ Compte YouTube connecté: ${channelName} (${channelId})`);
    return { channelId, channelName };
  }

  async listAccounts() {
    return this.prisma.youtubeAccount.findMany({
      select: { id: true, channelId: true, channelName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async disconnectAccount(id: string) {
    await this.prisma.youtubeAccount.delete({ where: { id } });
  }

  isAuthenticated(): boolean {
    // Legacy check — kept for backward compat
    return true;
  }

  private async loadClientForAccount(youtubeAccountId: string): Promise<OAuth2Client> {
    const account = await this.prisma.youtubeAccount.findUnique({
      where: { id: youtubeAccountId },
    });
    if (!account) throw new Error(`Compte YouTube ${youtubeAccountId} introuvable`);

    const client = this.newOAuthClient();
    client.setCredentials(account.tokens as any);

    // Auto-save refreshed tokens
    client.on('tokens', async (newTokens) => {
      const merged = { ...(account.tokens as object), ...newTokens };
      await this.prisma.youtubeAccount.update({
        where: { id: youtubeAccountId },
        data: { tokens: merged },
      });
    });

    return client;
  }

  async uploadVideo(params: {
    filePath: string;
    title: string;
    description?: string;
    thumbnailPath?: string;
    privacyStatus?: 'public' | 'unlisted' | 'private';
    youtubeAccountId: string;
  }): Promise<string> {
    const client = await this.loadClientForAccount(params.youtubeAccountId);
    const yt = google.youtube({ version: 'v3', auth: client });

    this.logger.log(`📤 Upload YouTube: ${params.title}`);

    const resource: youtube_v3.Schema$Video = {
      snippet: {
        title: params.title,
        description: params.description ?? '',
      },
      status: {
        privacyStatus: params.privacyStatus ?? 'unlisted',
        selfDeclaredMadeForKids: false,
      },
    };

    const res = await yt.videos.insert({
      part: ['snippet', 'status'],
      requestBody: resource,
      media: {
        mimeType: 'video/mp4',
        body: fs.createReadStream(params.filePath),
      },
    });

    const videoId = res.data.id!;
    this.logger.log(`✅ Vidéo uploadée: https://youtu.be/${videoId}`);

    if (params.thumbnailPath && fs.existsSync(params.thumbnailPath)) {
      try {
        await yt.thumbnails.set({
          videoId,
          media: { mimeType: 'image/jpeg', body: fs.createReadStream(params.thumbnailPath) },
        });
        this.logger.log(`🖼️ Thumbnail uploadée pour ${videoId}`);
      } catch (err) {
        this.logger.warn(`Thumbnail upload failed: ${(err as Error).message}`);
      }
    }

    return videoId;
  }

  async createPlaylist(title: string, youtubeAccountId: string, options?: { description?: string; privacyStatus?: string }): Promise<string> {
    const client = await this.loadClientForAccount(youtubeAccountId);
    const yt = google.youtube({ version: 'v3', auth: client });
    const res = await yt.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description: options?.description ?? '' },
        status: { privacyStatus: options?.privacyStatus ?? 'public' },
      },
    });
    const playlistId = res.data.id!;
    this.logger.log(`📋 Playlist créée: ${playlistId} — "${title}"`);
    return playlistId;
  }

  async addToPlaylist(playlistId: string, videoId: string, youtubeAccountId: string): Promise<void> {
    const client = await this.loadClientForAccount(youtubeAccountId);
    const yt = google.youtube({ version: 'v3', auth: client });
    await yt.playlistItems.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          playlistId,
          resourceId: { kind: 'youtube#video', videoId },
        },
      },
    });
    this.logger.log(`➕ Vidéo ${videoId} ajoutée à la playlist ${playlistId}`);
  }
}
