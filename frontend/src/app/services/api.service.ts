import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Tournament {
  id: string;
  name: string;
  slug: string;
  startAt?: string;
}

export interface Vod {
  id: string;
  sourceUrl: string;
  filePath?: string;
  status: string;
  eventStartGGId?: string;
  streamName?: string;
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
  getTournaments(): Observable<Tournament[]> {
    return this.http.get<Tournament[]>(`${this.base}/tournaments`);
  }

  getTournamentBySlug(slug: string): Observable<Tournament> {
    return this.http.get<Tournament>(`${this.base}/tournaments/${slug}`);
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

  updateClip(clipId: string, data: Partial<Clip>): Observable<Clip> {
    return this.http.patch<Clip>(`${this.base}/clips/${clipId}`, data);
  }

  recutClip(clipId: string, startSeconds: number, endSeconds: number): Observable<Clip> {
    return this.http.post<Clip>(`${this.base}/clips/${clipId}/recut`, { startSeconds, endSeconds });
  }
}
