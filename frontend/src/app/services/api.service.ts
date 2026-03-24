import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  roundName?: string;
  players?: string;
  score?: string;
  thumbnailUrl?: string;
  youtubeVideoId?: string;
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
  private readonly base = 'http://localhost:3000/api';

  // Tournaments
  searchStartGGTournaments(q: string): Observable<StartGGTournamentResult[]> {
    return this.http.get<StartGGTournamentResult[]>(`${this.base}/startgg/search?q=${encodeURIComponent(q)}`);
  }

  importTournament(slug: string): Observable<{ data: Tournament }> {
    return this.http.post<{ data: Tournament }>(`${this.base}/tournaments/import/${slug}`, {});
  }

  getTournaments(): Observable<Tournament[]> {
    return this.http.get<Tournament[]>(`${this.base}/tournaments`);
  }

  getTournamentBySlug(slug: string): Observable<Tournament> {
    return this.http.get<Tournament>(`${this.base}/tournaments/${slug}`);
  }

  getStartGGEvents(slug: string): Observable<{ tournament: any; events: StartGGEvent[] }> {
    return this.http.get<{ tournament: any; events: StartGGEvent[] }>(`${this.base}/startgg/tournaments/${slug}/events`);
  }

  getTournamentVods(tournamentId: string): Observable<Vod[]> {
    return this.http.get<Vod[]>(`${this.base}/tournaments/${tournamentId}/vods`);
  }

  addVod(data: { sourceUrl: string; tournamentId?: string; eventStartGGId?: string; streamName?: string }): Observable<any> {
    return this.http.post(`${this.base}/vods`, data);
  }

  // VODs
  getVod(vodId: string): Observable<Vod> {
    return this.http.get<Vod>(`${this.base}/vods/${vodId}`);
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
    return this.http.get<Clip[]>(`${this.base}/vods/${vodId}/clips`);
  }

  getStreamUrl(vodId: string): string {
    return `${this.base}/vods/${vodId}/stream`;
  }

  // Clips
  getClip(clipId: string): Observable<Clip> {
    return this.http.get<Clip>(`${this.base}/clips/${clipId}`);
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
    return this.http.patch<Clip>(`${this.base}/clips/${clipId}`, data);
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

  updateVod(vodId: string, data: Partial<Vod>): Observable<Vod> {
    return this.http.patch<Vod>(`${this.base}/vods/${vodId}`, data);
  }

  remuxVod(vodId: string): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/remux`, {});
  }

  getTournamentApprovedClips(tournamentId: string): Observable<Clip[]> {
    return this.http.get<Clip[]>(`${this.base}/tournaments/${tournamentId}/approved-clips`);
  }

  uploadClipThumbnail(clipId: string, file: File): Observable<Clip> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<Clip>(`${this.base}/clips/${clipId}/thumbnail`, form);
  }

  createManualClip(vodId: string, data: { startSeconds: number; endSeconds: number; title?: string }): Observable<any> {
    return this.http.post(`${this.base}/vods/${vodId}/manual-clip`, data);
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
