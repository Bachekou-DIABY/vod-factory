import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Vod, Clip, ClipPlan } from '../../services/api.service';

@Component({
  selector: 'app-vod-detail',
  imports: [RouterLink],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a routerLink="/" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← Retour</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else if (vod(); as v) {
        <div class="flex items-start justify-between mb-6">
          <div>
            <h1 class="text-2xl font-bold truncate max-w-2xl">{{ v.sourceUrl }}</h1>
            <span class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium"
              [class]="statusClass(v.status)">{{ v.status }}</span>
          </div>
        </div>

        <!-- Video player -->
        @if (v.filePath) {
          <video
            class="w-full max-w-4xl rounded-xl mb-8 bg-black"
            controls
            preload="metadata"
            [src]="api.getStreamUrl(v.id)"
          ></video>
        }

        <!-- Actions -->
        <div class="flex gap-3 mb-8">
          <button
            (click)="analyze()"
            [disabled]="analyzing()"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {{ analyzing() ? 'Analyse en cours...' : 'Analyser' }}
          </button>

          @if (v.events?.length) {
            <button
              (click)="loadClipPlan()"
              class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
            >
              Voir clip plan
            </button>
            <button
              (click)="clip()"
              [disabled]="clipping()"
              class="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {{ clipping() ? 'Clipping...' : 'Lancer le clipping' }}
            </button>
          }
        </div>

        <!-- Clip Plan -->
        @if (clipPlan(); as plan) {
          <div class="mb-8">
            <h2 class="text-xl font-semibold mb-4">
              Clip Plan — {{ plan.totalSets }} sets, {{ plan.totalGamePairs }} games détectés
            </h2>
            <div class="grid gap-2">
              @for (entry of plan.plan; track entry.setOrder) {
                <div class="bg-gray-900 rounded-lg p-4 border border-gray-800"
                  [class.opacity-50]="entry.skipped">
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="text-xs text-gray-500 mr-2">Set {{ entry.setOrder }}</span>
                      <span class="font-medium">{{ entry.roundName }}</span>
                    </div>
                    <div class="flex items-center gap-3 text-sm">
                      <span class="text-gray-400">{{ entry.durationMin }} min</span>
                      @if (entry.fallbackToCompletedAt) {
                        <span class="text-yellow-500 text-xs">fallback</span>
                      }
                      <span class="text-gray-500">{{ entry.startSeconds }}s → {{ entry.endSeconds }}s</span>
                    </div>
                  </div>
                  @if (entry.players) {
                    <div class="text-sm text-gray-400 mt-1">{{ entry.players }} — {{ entry.score }}</div>
                  }
                  <div class="text-xs text-gray-600 mt-1">
                    {{ entry.gamesFoundInWindow }}/{{ entry.gameCount }} games détectés
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Clips -->
        @if (clips().length) {
          <div>
            <h2 class="text-xl font-semibold mb-4">Clips ({{ clips().length }})</h2>
            <div class="grid gap-3">
              @for (clip of clips(); track clip.id) {
                <a
                  [routerLink]="['/clips', clip.id]"
                  class="block bg-gray-900 rounded-lg p-4 hover:bg-gray-800 transition-colors border border-gray-800"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="text-sm text-gray-500 mr-2">Set {{ clip.setOrder }}</span>
                      <span class="font-medium">{{ clip.roundName ?? 'Set ' + clip.setOrder }}</span>
                    </div>
                    <div class="flex items-center gap-3 text-sm">
                      <span class="text-gray-400">
                        {{ formatDuration(clip.startSeconds, clip.endSeconds) }}
                      </span>
                      <span class="px-2 py-0.5 rounded text-xs font-medium"
                        [class]="clipStatusClass(clip.status)">{{ clip.status }}</span>
                    </div>
                  </div>
                  @if (clip.players) {
                    <div class="text-sm text-gray-400 mt-1">{{ clip.players }}</div>
                  }
                </a>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class VodDetailPage implements OnInit {
  protected readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  vod = signal<Vod | null>(null);
  clips = signal<Clip[]>([]);
  clipPlan = signal<ClipPlan | null>(null);
  loading = signal(true);
  analyzing = signal(false);
  clipping = signal(false);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getVod(id).subscribe({
      next: (v) => { this.vod.set(v); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.getClips(id).subscribe({ next: (c) => this.clips.set(c) });
  }

  analyze() {
    const id = this.vod()!.id;
    this.analyzing.set(true);
    this.api.analyzeVod(id).subscribe({
      next: () => {
        this.analyzing.set(false);
        this.api.getVod(id).subscribe((v) => this.vod.set(v));
      },
      error: () => this.analyzing.set(false),
    });
  }

  loadClipPlan() {
    this.api.getClipPlan(this.vod()!.id).subscribe((p) => this.clipPlan.set(p));
  }

  clip() {
    this.clipping.set(true);
    this.api.clipVod(this.vod()!.id).subscribe({
      next: () => {
        this.clipping.set(false);
        this.api.getClips(this.vod()!.id).subscribe((c) => this.clips.set(c));
      },
      error: () => this.clipping.set(false),
    });
  }

  formatDuration(start: number, end: number): string {
    const min = Math.round((end - start) / 60);
    return `${min} min`;
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      PENDING: 'bg-gray-700 text-gray-300',
      DOWNLOADING: 'bg-blue-900 text-blue-300',
      DOWNLOADED: 'bg-blue-700 text-blue-200',
      ANALYZING: 'bg-yellow-900 text-yellow-300',
      ANALYZED: 'bg-green-900 text-green-300',
      PROCESSING: 'bg-purple-900 text-purple-300',
      COMPLETED: 'bg-green-700 text-green-200',
      FAILED: 'bg-red-900 text-red-300',
    };
    return map[status] ?? 'bg-gray-700 text-gray-300';
  }

  clipStatusClass(status: string): string {
    const map: Record<string, string> = {
      PENDING: 'bg-gray-700 text-gray-300',
      APPROVED: 'bg-green-800 text-green-300',
      UPLOADING: 'bg-blue-800 text-blue-300',
      UPLOADED: 'bg-green-600 text-white',
      FAILED: 'bg-red-800 text-red-300',
    };
    return map[status] ?? 'bg-gray-700 text-gray-300';
  }
}
