import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

const TOKENS_PATH = path.join(process.cwd(), 'storage', 'youtube-tokens.json');
const REDIRECT_URI = 'http://localhost:3000/api/youtube/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);
  private oauth2Client: OAuth2Client | null = null;

  private getClient(): OAuth2Client {
    if (!this.oauth2Client) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis dans .env');
      }
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
    }
    return this.oauth2Client;
  }

  getAuthUrl(): string {
    const client = this.getClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  }

  async handleCallback(code: string): Promise<void> {
    const client = this.getClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const dir = path.dirname(TOKENS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    this.logger.log('✅ Tokens YouTube sauvegardés');
  }

  isAuthenticated(): boolean {
    return fs.existsSync(TOKENS_PATH);
  }

  private loadClient(): OAuth2Client {
    const client = this.getClient();
    if (!fs.existsSync(TOKENS_PATH)) {
      throw new Error('Non authentifié — visite /api/youtube/auth-url d\'abord');
    }
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    client.setCredentials(tokens);
    // Auto-save refreshed tokens
    client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2));
    });
    return client;
  }

  async uploadVideo(params: {
    filePath: string;
    title: string;
    description?: string;
    thumbnailPath?: string;
    privacyStatus?: 'public' | 'unlisted' | 'private';
  }): Promise<string> {
    const client = this.loadClient();
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

    // Upload thumbnail if available
    if (params.thumbnailPath && fs.existsSync(params.thumbnailPath)) {
      try {
        await yt.thumbnails.set({
          videoId,
          media: {
            mimeType: 'image/jpeg',
            body: fs.createReadStream(params.thumbnailPath),
          },
        });
        this.logger.log(`🖼️ Thumbnail uploadée pour ${videoId}`);
      } catch (err) {
        this.logger.warn(`Thumbnail upload failed: ${(err as Error).message}`);
      }
    }

    return videoId;
  }

  async createPlaylist(title: string): Promise<string> {
    const client = this.loadClient();
    const yt = google.youtube({ version: 'v3', auth: client });
    const res = await yt.playlists.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title },
        status: { privacyStatus: 'public' },
      },
    });
    const playlistId = res.data.id!;
    this.logger.log(`📋 Playlist créée: ${playlistId} — "${title}"`);
    return playlistId;
  }

  async addToPlaylist(playlistId: string, videoId: string): Promise<void> {
    const client = this.loadClient();
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
