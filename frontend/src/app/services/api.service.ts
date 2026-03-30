import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { Observable, map, filter, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Tournament {
  id: string;
  name: string;
  slug: string;
  startAt?: string;
}

export interface StartGGEvent {
  id: string;
  name: string;
  slug?: string;
}

export interface StartGGTournamentResult {
  id: string;
  name: string;
  slug: string;
  startAt?: number;
}

export interface Vod {
  id: string;
  sourceUrl: string;
  filePath?: string;
  status: string;
  eventStartGGId?: string;
  streamName?: string;
  name?: string;
  tournamentSlug?: string;
  events?: any[];
  createdAt: string;
}

export interface Clip {
  id: string;
  vodId: string;
  setOrder: number;
  setStartGGId?: string;
  filePath: string;
  startSeconds: number;
  endSeconds: number;
  title?: string;
  description?: string;
  roundName?: string;
  players?: string;
  score?: string;
  thumbnailUrl?: string;
  youtubeVideoId?: string;
  privacyStatus?: string;
  status: string;
  createdAt: string;
}

export interface ClipPlan {
  vodId: string;
  totalGamePairs: number;
  totalSets: number;
  plan: ClipPlanEntry[];
}

export interface ClipPlanEntry {
  setOrder: number;
  roundName: string;
  players: string;
  score: string;
  gameCount: number;
  gamesFoundInWindow: number;
  startSeconds: number;
  endSeconds: number;
  durationMin: number;
  fallbackToCompletedAt: boolean;
  skipped?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;
  private readonly _cache = new Map<string, { data: unknown; ts: number }>();

  private cached<T>(key: string, obs: Observable<T>, ttl = 5000): Observable<T> {
    const hit = this._cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return of(hit.data as T);
    return obs.pipe(tap(d => this._cache.set(key, { data: d, ts: Date.now() })));
  }

  invalidate(keyPrefix: string) {
    for (const key of this._cache.keys()) {
      if (key.startsWith(keyPrefix)) this._cache.delete(key);
    }
  }

  // Tournaments
  searchStartGGTournaments(q: string): Observable<StartGGTournamentResult[]> {
    return this.http.get<StartGGTournamentResult[]>(`${this.base}/startgg/search?q=${encodeURIComponent(q)}`);
  }

  importTournament(slug: string): Observable<{ data: Tournament }> {
    return this.http.post<{ data: Tournament }>(`${this.base}/tournaments/import/${slug}`, {}).pipe(
      tap(() => this.invalidate('tournaments')),
    );
  }

  getTournaments(): Observable<Tournament[]> {
    return this.cached('tournaments', this.http.get<Tournament[]>(`${this.base}/tournaments`), 30000);
  }

  getTournamentBySlug(slug: string): Observable<Tournament> {
    return this.cached(`tournament:${slug}`, this.http.get<Tournament>(`${this.base}/tournaments/${slug}`), 30000);
  }

  getStartGGEvents(slug: string): Observable<{ tournament: any; events: StartGGEvent[] }> {
    return this.http.get<{ tournament: any; events: StartGGEvent[] }>(`${this.base}/startgg/tournaments/${slug}/events`);
  }

  getTournamentVods(tournamentId: string): Observable<Vod[]> {
    return this.cached(`tournament-vods:${tournamentId}`, this.http.get<Vod[]>(`${this.base}/tournaments/${tournamentId}/vods`), 5000);
  }

  addVod(data: { sourceUrl: string; tournamentId?: string; eventStartGGId?: string; streamName?: string }): Observable<any> {
    return this.http.post(`${this.base}/vods`, data).pipe(
      tap(() => { if (data.tournamentId) this.invalidate(`tournament-vods:${data.tournamentId}`); }),
    );
  }

  // VODs
  getVod(vodId: string): Observable<Vod> {
    return this.cached(`vod:${vodId}`, this.http.get<Vod>(`${this.base}/vods/${vodId}`), 3000);
  }

  analyzeVod(vodId: string): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/analyze`, {});
  }

  getClipPlan(vodId: string): Observable<ClipPlan> {
    return this.http.get<ClipPlan>(`${this.base}/vods/${vodId}/clip-plan`);
  }

  clipVod(vodId: string): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/clip`, {});
  }

  getClips(vodId: string): Observable<Clip[]> {
    return this.cached(`clips:${vodId}`, this.http.get<Clip[]>(`${this.base}/vods/${vodId}/clips`), 3000);
  }

  getStreamUrl(vodId: string): string {
    return `${this.base}/vods/${vodId}/stream`;
  }

  // Clips
  getClip(clipId: string): Observable<Clip> {
    return this.cached(`clip:${clipId}`, this.http.get<Clip>(`${this.base}/clips/${clipId}`), 3000);
  }

  getClipStreamUrl(clipId: string): string {
    return `${this.base}/clips/${clipId}/stream`;
  }

  getClipThumbnailUrl(clipId: string): string {
    return `${this.base}/clips/${clipId}/thumbnail`;
  }

  generateClips(vodId: string, body: { vodRecordedAtUnix?: number; preBufferSeconds?: number; postBufferSeconds?: number }): Observable<any> {
    return this.http.post(`${this.base}/startgg/vods/${vodId}/generate-clips`, body);
  }

  updateClip(clipId: string, data: Partial<Clip>): Observable<Clip> {
    return this.http.patch<Clip>(`${this.base}/clips/${clipId}`, data).pipe(
      tap(() => { this.invalidate(`clip:${clipId}`); this.invalidate('clips:'); this.invalidate('approved:'); }),
    );
  }

  recutClip(clipId: string, startSeconds: number, endSeconds: number): Observable<Clip> {
    return this.http.post<Clip>(`${this.base}/clips/${clipId}/recut`, { startSeconds, endSeconds });
  }

  deleteClip(clipId: string): Observable<any> {
    return this.http.delete(`${this.base}/clips/${clipId}`);
  }

  deleteVod(vodId: string): Observable<any> {
    return this.http.delete(`${this.base}/vods/${vodId}`);
  }

  deleteVodSourceFile(vodId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.base}/vods/${vodId}/file`);
  }

  updateVod(vodId: string, data: Partial<Vod>): Observable<Vod> {
    return this.http.patch<Vod>(`${this.base}/vods/${vodId}`, data).pipe(
      tap(() => this.invalidate(`vod:${vodId}`)),
    );
  }

  remuxVod(vodId: string): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/remux`, {});
  }

  getTournamentApprovedClips(tournamentId: string): Observable<Clip[]> {
    return this.cached(`approved:${tournamentId}`, this.http.get<Clip[]>(`${this.base}/tournaments/${tournamentId}/approved-clips`), 5000);
  }

  uploadClipThumbnail(clipId: string, file: File): Observable<Clip> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<Clip>(`${this.base}/clips/${clipId}/thumbnail`, form);
  }

  createManualClip(vodId: string, data: { startSeconds: number; endSeconds: number; title?: string }): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/manual-clip`, data);
  }

  getDownloadProgress(vodId: string): Observable<{ progress: number | null; status: string }> {
    return this.http.get<{ progress: number | null; status: string }>(`${this.base}/vods/${vodId}/download-progress`);
  }

  getClipDownloadUrl(clipId: string): string {
    return `${this.base}/clips/${clipId}/download`;
  }

  retryVodDownload(vodId: string): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/retry-download`, {}).pipe(
      tap(() => this.invalidate(`vod:${vodId}`)),
    );
  }

  fetchVodTimestamp(vodId: string, url?: string): Observable<{ timestamp: number }> {
    const params = url ? `?url=${encodeURIComponent(url)}` : '';
    return this.http.get<{ timestamp: number }>(`${this.base}/vods/${vodId}/fetch-timestamp${params}`);
  }

  retryClip(clipId: string): Observable<any> {
    return this.http.post(`${this.base}/clips/${clipId}/retry`, {}).pipe(
      tap(() => { this.invalidate(`clip:${clipId}`); this.invalidate('clips:'); }),
    );
  }

  uploadVodFile(
    file: File,
    meta: { tournamentId?: string; eventStartGGId?: string; streamName?: string },
    onProgress?: (pct: number) => void,
  ): Observable<Vod> {
    const form = new FormData();
    form.append('file', file);
    if (meta.tournamentId) form.append('tournamentId', meta.tournamentId);
    if (meta.eventStartGGId) form.append('eventStartGGId', meta.eventStartGGId);
    if (meta.streamName) form.append('streamName', meta.streamName);

    return this.http.post<Vod>(`${this.base}/vods/upload`, form, {
      reportProgress: true,
      observe: 'events',
    }).pipe(
      map((event) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          onProgress?.(Math.round(100 * event.loaded / event.total));
        }
        if (event.type === HttpEventType.Response) return event.body as Vod;
        return null;
      }),
      filter((v): v is Vod => v !== null),
    );
  }

  // YouTube
  getYoutubeStatus(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>(`${this.base}/youtube/status`);
  }

  getYoutubeAuthUrl(): Observable<{ url: string; authenticated: boolean }> {
    return this.http.get<{ url: string; authenticated: boolean }>(`${this.base}/youtube/auth-url`);
  }

  uploadClipToYoutube(clipId: string): Observable<{ message?: string; youtubeVideoId?: string; alreadyUploaded?: boolean }> {
    return this.http.post<any>(`${this.base}/clips/${clipId}/upload-youtube`, {});
  }
}
