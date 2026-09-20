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

/**
 * La chaîne a atteint son plafond de mises en ligne du jour.
 *
 * À ne pas confondre avec le quota du projet API, qui se demande dans la
 * console Google et se compte en unités : celui-ci appartient à la chaîne
 * YouTube, vaut une dizaine de vidéos tant qu'elle n'est pas vérifiée, et
 * aucune augmentation de quota API ne le déplace.
 */
export class PlafondChaineAtteint extends Error {
  constructor() {
    super(
      'La chaîne a atteint son nombre maximal de mises en ligne pour aujourd hui. ' +
        'Vérifie la chaîne sur YouTube pour relever ce plafond, ou reprends demain.',
    );
    this.name = 'PlafondChaineAtteint';
  }
}

/** Reconnaît la réponse de YouTube signalant ce plafond. */
function estPlafondChaine(err: unknown): boolean {
  const e = err as { message?: string; errors?: Array<{ reason?: string }> };
  if (e?.errors?.some((x) => x.reason === 'uploadLimitExceeded')) return true;
  return /exceeded the number of videos/i.test(e?.message ?? '');
}

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

    let res;
    try {
      res = await yt.videos.insert({
        part: ['snippet', 'status'],
        requestBody: resource,
        media: {
          mimeType: 'video/mp4',
          body: fs.createReadStream(params.filePath),
        },
      });
    } catch (err) {
      if (estPlafondChaine(err)) throw new PlafondChaineAtteint();
      throw err;
    }

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
        // Non répertoriée par défaut, comme les clips. Une playlist publique
        // rend le tournoi visible avant même qu'on ait relu les vidéos.
        status: { privacyStatus: options?.privacyStatus ?? 'unlisted' },
      },
    });
    const playlistId = res.data.id!;
    this.logger.log(`📋 Playlist créée: ${playlistId} — "${title}"`);
    return playlistId;
  }

  /**
   * Ajoute une vidéo à une playlist, avec réessais.
   *
   * L'appel échoue de façon transitoire quand il suit de près la création de la
   * playlist ou la fin d'un envoi : observé en production avec « The operation
   * was aborted », dans la seconde qui suivait la création. La vidéo était bien
   * en ligne, mais hors de la playlist, et personne ne le voyait puisque
   * l'erreur était avalée.
   */
  async addToPlaylist(
    playlistId: string,
    videoId: string,
    youtubeAccountId: string,
    essais = 3,
  ): Promise<void> {
    let derniere: unknown;
    for (let tentative = 1; tentative <= essais; tentative++) {
      try {
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
        return;
      } catch (err) {
        derniere = err;
        this.logger.warn(
          `Ajout à la playlist, tentative ${tentative}/${essais} échouée : ${(err as Error).message}`,
        );
        if (tentative < essais) {
          await new Promise((r) => setTimeout(r, 2000 * tentative));
        }
      }
    }
    throw derniere;
  }

  /**
   * Renomme une playlist, et change au besoin sa description ou sa visibilité.
   *
   * L'API exige que le snippet envoyé soit complet : un titre omis effacerait
   * celui en place. On relit donc la playlist avant d'écrire.
   */
  async updatePlaylist(
    playlistId: string,
    youtubeAccountId: string,
    changements: { title?: string; description?: string; privacyStatus?: string },
  ): Promise<void> {
    const client = await this.loadClientForAccount(youtubeAccountId);
    const yt = google.youtube({ version: 'v3', auth: client });

    const actuel = await yt.playlists.list({
      part: ['snippet', 'status'],
      id: [playlistId],
    });
    const existante = actuel.data.items?.[0];
    if (!existante) {
      throw new Error(`Playlist ${playlistId} introuvable sur la chaîne`);
    }

    await yt.playlists.update({
      part: ['snippet', 'status'],
      requestBody: {
        id: playlistId,
        snippet: {
          title: changements.title ?? existante.snippet?.title ?? '',
          description:
            changements.description ?? existante.snippet?.description ?? '',
        },
        status: {
          privacyStatus:
            changements.privacyStatus ??
            existante.status?.privacyStatus ??
            'unlisted',
        },
      },
    });
    this.logger.log(`✏️ Playlist ${playlistId} mise à jour`);
  }

  /** Identifiants des vidéos déjà présentes dans une playlist. */
  async listPlaylistVideoIds(
    playlistId: string,
    youtubeAccountId: string,
  ): Promise<Set<string>> {
    const client = await this.loadClientForAccount(youtubeAccountId);
    const yt = google.youtube({ version: 'v3', auth: client });
    const presents = new Set<string>();
    let pageToken: string | undefined;
    do {
      const res = await yt.playlistItems.list({
        part: ['contentDetails'],
        playlistId,
        maxResults: 50,
        pageToken,
      });
      for (const item of res.data.items ?? []) {
        const id = item.contentDetails?.videoId;
        if (id) presents.add(id);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return presents;
  }
}
