import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Clip, Tournament } from '../../services/api.service';

@Component({
  selector: 'app-tournament-approved',
  imports: [RouterLink],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a [routerLink]="['/tournaments', slug]" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← Tournoi</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else {
        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold">Clips approuvés</h1>
            @if (tournament()) {
              <p class="text-gray-400 text-sm mt-1">{{ tournament()!.name }}</p>
            }
          </div>
          <span class="px-3 py-1 bg-green-800 text-green-300 rounded-full text-sm font-medium">
            {{ clips().length }} clip{{ clips().length > 1 ? 's' : '' }}
          </span>
        </div>

        <!-- YouTube Auth Banner -->
        @if (!ytAuthenticated()) {
          <div class="mb-6 p-4 bg-red-950 border border-red-800 rounded-xl flex items-center justify-between gap-4">
            <div>
              <p class="font-medium text-red-300">YouTube non connecté</p>
              <p class="text-sm text-red-400 mt-0.5">Connecte ton compte Google pour uploader les clips.</p>
            </div>
            <button (click)="connectYoutube()"
              class="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors shrink-0">
              Connecter YouTube
            </button>
          </div>
        } @else {
          <div class="mb-6 p-3 bg-green-950 border border-green-800 rounded-xl flex items-center gap-3">
            <span class="text-green-400 text-lg">✓</span>
            <p class="text-sm text-green-300">YouTube connecté — tu peux uploader les clips.</p>
          </div>
        }

        @if (clips().length === 0) {
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p class="text-gray-400">Aucun clip approuvé pour ce tournoi.</p>
            <p class="text-gray-600 text-sm mt-2">Ouvre un clip et clique sur "Approuver ✓" pour le marquer comme prêt.</p>
          </div>
        } @else {
          <!-- Upload All Button -->
          @if (ytAuthenticated() && hasUploadable()) {
            <div class="mb-4 flex justify-end">
              <button (click)="uploadAll()"
                [disabled]="uploadingAll()"
                class="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                @if (uploadingAll()) {
                  <span class="animate-spin">⏳</span> Upload en cours...
                } @else {
                  ▶ Tout uploader sur YouTube
                }
              </button>
            </div>
          }

          <div class="grid gap-3">
            @for (clip of clips(); track clip.id) {
              <div class="flex gap-4 bg-gray-900 rounded-xl p-4 border border-gray-800">
                <!-- Thumbnail -->
                <a [routerLink]="['/clips', clip.id]" class="shrink-0 w-40 rounded-lg overflow-hidden bg-gray-800" style="height:90px">
                  <img
                    [src]="api.getClipThumbnailUrl(clip.id)"
                    class="w-full h-full object-cover"
                    loading="lazy"
                    (error)="$any($event.target).style.display='none'"
                  />
                </a>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <p class="font-semibold text-white truncate">{{ clip.title ?? (clip.roundName ?? 'Set ' + clip.setOrder) }}</p>
                      @if (clip.roundName && clip.title) {
                        <p class="text-xs text-gray-500 mt-0.5">{{ clip.roundName }}</p>
                      }
                      @if (clip.players) {
                        <p class="text-sm text-gray-400 mt-1">{{ clip.players }}</p>
                      }
                      @if (clip.score) {
                        <p class="text-xs text-gray-500">{{ clip.score }}</p>
                      }
                      <!-- YouTube link -->
                      @if (clip.youtubeVideoId) {
                        <a [href]="'https://youtu.be/' + clip.youtubeVideoId" target="_blank"
                          class="inline-flex items-center gap-1 mt-1 text-xs text-red-400 hover:text-red-300">
                          ▶ youtu.be/{{ clip.youtubeVideoId }}
                        </a>
                      }
                    </div>
                    <div class="text-right shrink-0 flex flex-col items-end gap-2">
                      <p class="text-sm text-gray-400">{{ formatDuration(clip.startSeconds, clip.endSeconds) }}</p>

                      <!-- Status / Upload button -->
                      @if (clip.status === 'UPLOADED') {
                        <span class="px-2 py-1 bg-red-900 text-red-300 rounded text-xs font-medium">✓ YouTube</span>
                      } @else if (clip.status === 'UPLOADING') {
                        <span class="px-2 py-1 bg-yellow-900 text-yellow-300 rounded text-xs font-medium animate-pulse">⏳ Upload...</span>
                      } @else if (clip.status === 'FAILED') {
                        <button (click)="uploadOne(clip)"
                          class="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs transition-colors">
                          ↺ Réessayer
                        </button>
                      } @else if (ytAuthenticated()) {
                        <button (click)="uploadOne(clip)"
                          class="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs transition-colors">
                          ▶ Upload YT
                        </button>
                      }

                      <a [routerLink]="['/clips', clip.id]"
                        class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                        Modifier
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            }
          </div>

          @if (uploadMsg()) {
            <div class="mt-4 p-3 bg-gray-800 rounded-lg text-sm text-gray-300">{{ uploadMsg() }}</div>
          }
        }
      }
    </div>
  `,
})
export class TournamentApprovedPage implements OnInit {
  protected readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  slug = '';
  tournament = signal<Tournament | null>(null);
  clips = signal<Clip[]>([]);
  loading = signal(true);
  ytAuthenticated = signal(false);
  uploadingAll = signal(false);
  uploadMsg = signal('');

  ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug')!;

    this.api.getYoutubeStatus().subscribe({
      next: (s) => this.ytAuthenticated.set(s.authenticated),
      error: () => {},
    });

    this.api.getTournamentBySlug(this.slug).subscribe({
      next: (t) => {
        this.tournament.set(t);
        this.api.getTournamentApprovedClips(t.id).subscribe({
          next: (clips) => { this.clips.set(clips); this.loading.set(false); },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
    });
  }

  hasUploadable(): boolean {
    return this.clips().some(c => c.status !== 'UPLOADED' && c.status !== 'UPLOADING');
  }

  connectYoutube() {
    this.api.getYoutubeAuthUrl().subscribe({
      next: (r) => window.open(r.url, '_blank'),
      error: (err) => alert('Erreur: ' + (err.error?.message ?? err.message)),
    });
  }

  uploadOne(clip: Clip) {
    // Optimistic UI
    this.clips.update(list => list.map(c => c.id === clip.id ? { ...c, status: 'UPLOADING' } : c));
    this.api.uploadClipToYoutube(clip.id).subscribe({
      next: (r) => {
        if (r.alreadyUploaded) {
          this.clips.update(list => list.map(c => c.id === clip.id ? { ...c, status: 'UPLOADED', youtubeVideoId: r.youtubeVideoId } : c));
        } else {
          this.uploadMsg.set('Upload en cours en arrière-plan...');
          this.pollClip(clip.id);
        }
      },
      error: (err) => {
        this.clips.update(list => list.map(c => c.id === clip.id ? { ...c, status: 'FAILED' } : c));
        this.uploadMsg.set('Erreur: ' + (err.error?.message ?? err.message));
      },
    });
  }

  uploadAll() {
    const uploadable = this.clips().filter(c => c.status !== 'UPLOADED' && c.status !== 'UPLOADING');
    if (uploadable.length === 0) return;
    this.uploadingAll.set(true);
    this.uploadMsg.set(`Upload de ${uploadable.length} clips en cours...`);
    uploadable.forEach(c => this.uploadOne(c));
    setTimeout(() => this.uploadingAll.set(false), 2000);
  }

  private pollClip(clipId: string, attempts = 0) {
    if (attempts > 60) return; // Stop after ~5min
    setTimeout(() => {
      this.api.getClip(clipId).subscribe({
        next: (c) => {
          this.clips.update(list => list.map(existing =>
            existing.id === clipId ? { ...existing, status: c.status, youtubeVideoId: (c as any).youtubeVideoId } : existing
          ));
          if (c.status === 'UPLOADING') {
            this.pollClip(clipId, attempts + 1);
          } else if (c.status === 'UPLOADED') {
            this.uploadMsg.set('Upload terminé !');
          }
        },
        error: () => {},
      });
    }, 5000);
  }

  formatDuration(start: number, end: number): string {
    const s = Math.round(end - start);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m + 'min ' + sec + 's';
  }
}
