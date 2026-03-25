import { Component, inject, signal, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Clip } from '../../services/api.service';

@Component({
  selector: 'app-clip-review',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a [routerLink]="['/vods', clip()?.vodId]" fragment="clips-section" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← VOD</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else if (clip(); as c) {
        <div class="max-w-4xl">
          <div class="flex items-center justify-between mb-4">
            <h1 class="text-2xl font-bold">Set {{ c.setOrder }} — {{ c.roundName ?? 'Clip' }}</h1>
            <span class="px-3 py-1 rounded-full text-xs font-medium" [class]="statusClass(c.status)">
              {{ c.status }}
            </span>
          </div>

          @if (c.players) {
            <p class="text-gray-400 mb-4">{{ c.players }} — {{ c.score }}</p>
          }

          <!-- Player -->
          <video
            #videoEl
            class="w-full rounded-xl mb-4 bg-black"
            controls
            preload="metadata"
            [src]="clipUrl(c)"
            (loadedmetadata)="onMetadata()"
            (timeupdate)="onTimeUpdate()"
          ></video>

          <!-- Recut section -->
          <div class="bg-gray-900 rounded-xl p-5 mb-6 border border-gray-800">
            <div class="flex items-start justify-between mb-1">
              <h3 class="text-sm font-semibold text-gray-200">Recouper le clip</h3>
              <span class="text-xs text-gray-500">
                {{ formatTime(recutStart) }} — {{ formatTime(recutEnd) }}
                <span class="text-gray-600 ml-1">({{ formatDuration(recutEnd - recutStart) }})</span>
              </span>
            </div>
            <p class="text-xs text-gray-500 mb-4">Ajuste les poignées pour définir le début et la fin. Clique sur "Recouper" pour générer un nouveau fichier depuis la VOD originale.</p>

            <!-- Custom dual-handle slider -->
            <div
              class="relative h-10 flex items-center mb-4 cursor-pointer select-none"
              #sliderTrack
              (pointerdown)="onTrackPointerDown($event, sliderTrack)"
            >
              <!-- Track background -->
              <div class="absolute inset-x-2 h-2 bg-gray-700 rounded-full"></div>
              <!-- Selected range -->
              <div
                class="absolute h-2 bg-purple-600 rounded-full pointer-events-none"
                [style.left]="thumbLeft(startPct())"
                [style.right]="thumbRight(endPct())"
              ></div>
              <!-- Current time indicator -->
              @if (videoDuration() > 0) {
                <div
                  class="absolute w-px h-4 bg-white/40 pointer-events-none"
                  [style.left]="thumbLeft(currentPct())"
                ></div>
              }
              <!-- Start thumb -->
              <div
                class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-purple-500 -translate-x-1/2 z-10 pointer-events-none"
                [style.left]="thumbLeft(startPct())"
              ></div>
              <!-- End thumb -->
              <div
                class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-purple-400 -translate-x-1/2 z-10 pointer-events-none"
                [style.left]="thumbLeft(endPct())"
              ></div>
            </div>

            <!-- Precise inputs + preview buttons -->
            <div class="flex gap-4 items-center flex-wrap">
              <div class="flex items-center gap-2">
                <label class="text-xs text-gray-500 w-12 shrink-0">Début</label>
                <input type="number" step="1" [value]="recutStart" (change)="onStartInput($event)"
                  class="w-24 bg-gray-800 rounded-lg px-2 py-1 text-sm border border-gray-700 focus:border-purple-500 outline-none font-mono" />
                <span class="text-xs text-gray-600">s</span>
              </div>
              <div class="flex items-center gap-2">
                <label class="text-xs text-gray-500 w-12 shrink-0">Fin</label>
                <input type="number" step="1" [value]="recutEnd" (change)="onEndInput($event)"
                  class="w-24 bg-gray-800 rounded-lg px-2 py-1 text-sm border border-gray-700 focus:border-purple-500 outline-none font-mono" />
                <span class="text-xs text-gray-600">s</span>
              </div>
              <button (click)="seekVideo(recutStart)"
                class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                ⏮ Début
              </button>
              <button (click)="seekVideo(recutEnd - 5)"
                class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                ⏭ Fin
              </button>
              <button (click)="setRecutStartFromCurrent()"
                class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                📍 → Début
              </button>
              <button (click)="setRecutEndFromCurrent()"
                class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                📍 → Fin
              </button>
            </div>
          </div>

          <!-- Metadata edit -->
          <div class="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Titre</label>
              <input [(ngModel)]="editTitle"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                placeholder="Titre du clip" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Round</label>
              <input [(ngModel)]="editRound"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                placeholder="Winners Finals" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Joueurs</label>
              <input [(ngModel)]="editPlayers"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                placeholder="Player1 vs Player2" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Score</label>
              <input [(ngModel)]="editScore"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                placeholder="3 - 1" />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Visibilité YouTube</label>
              <select [(ngModel)]="editPrivacy"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none">
                <option value="unlisted">Non répertorié</option>
                <option value="public">Public</option>
                <option value="private">Privé</option>
              </select>
            </div>
            <div class="col-span-2">
              <label class="block text-xs text-gray-500 mb-1">
                Description YouTube
                <span class="text-gray-600 ml-1">(auto-générée si vide)</span>
              </label>
              <textarea [(ngModel)]="editDescription" rows="4"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none resize-none"
                placeholder="Description qui apparaîtra sur YouTube..."></textarea>
            </div>
          </div>

          <!-- Custom thumbnail -->
          <div class="mb-6">
            <label class="block text-xs text-gray-500 mb-2">Miniature personnalisée</label>
            <div class="flex items-center gap-4">
              @if (clip()?.thumbnailUrl) {
                <img [src]="clip()?.thumbnailUrl" class="w-24 h-14 rounded object-cover bg-gray-800" />
              }
              <label class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs cursor-pointer transition-colors">
                {{ uploadingThumb() ? 'Upload...' : '🖼️ Choisir une image' }}
                <input type="file" accept="image/*" class="hidden" (change)="onThumbFile($event)" [disabled]="uploadingThumb()" />
              </label>
              @if (thumbMsg()) {
                <span class="text-xs text-green-400">{{ thumbMsg() }}</span>
              }
            </div>
          </div>

          <!-- Actions with explanations -->
          <div class="flex gap-3 flex-wrap items-start justify-between">
            <div class="flex flex-col gap-1">
              <button (click)="recut()" [disabled]="recutting()"
                class="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
                {{ recutting() ? 'Recut en cours...' : '✂️ Recouper' }}
              </button>
              <span class="text-xs text-gray-600">Recoupe le fichier selon les bornes ci-dessus</span>
            </div>
            <div class="flex flex-col gap-1">
              <button (click)="save()" [disabled]="saving()"
                class="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
                {{ saving() ? 'Sauvegarde...' : 'Sauvegarder' }}
              </button>
              <span class="text-xs text-gray-600">Sauvegarde le titre et le round</span>
            </div>
            @if (clip()?.status !== 'APPROVED') {
              <div class="flex flex-col gap-1">
                <button (click)="approve()" [disabled]="saving()"
                  class="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
                  Approuver ✓
                </button>
                <span class="text-xs text-gray-600">Marque le clip comme prêt pour l'upload YouTube</span>
              </div>
            } @else {
              <div class="flex flex-col gap-1">
                <button (click)="disapprove()" [disabled]="saving()"
                  class="px-5 py-2 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
                  Désapprouver
                </button>
                <span class="text-xs text-gray-600">Repasse le clip en attente (retire l'approbation)</span>
              </div>
            }
            <div class="flex flex-col gap-1">
              <a [href]="api.getClipDownloadUrl(clip()!.id)" target="_blank"
                class="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors text-center">
                Télécharger
              </a>
              <span class="text-xs text-gray-600">Télécharge le fichier MP4</span>
            </div>
            <div class="flex flex-col gap-1">
              <button (click)="deleteClip()"
                class="px-5 py-2 bg-red-900 hover:bg-red-700 text-red-300 rounded-lg text-sm font-medium transition-colors">
                Supprimer
              </button>
              <span class="text-xs text-gray-600">Supprime ce clip définitivement</span>
            </div>
          </div>

          @if (successMsg()) {
            <p class="text-green-400 text-sm mt-3">{{ successMsg() }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class ClipReviewPage implements OnInit {
  @ViewChild('videoEl') videoEl!: ElementRef<HTMLVideoElement>;

  protected readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  clip = signal<Clip | null>(null);
  loading = signal(true);
  saving = signal(false);
  recutting = signal(false);
  successMsg = signal<string | null>(null);

  editTitle = '';
  editDescription = '';
  editRound = '';
  editPlayers = '';
  editScore = '';
  editPrivacy = 'unlisted';
  uploadingThumb = signal(false);
  thumbMsg = signal('');

  // Clip-file-relative positions (0 = start of clip file)
  recutStart = 0;
  recutEnd = 0;

  videoDuration = signal(0);
  currentTime = signal(0);

  // Active drag handle: 'start' | 'end' | null
  private dragging: 'start' | 'end' | null = null;

  startPct() {
    const d = this.videoDuration();
    return d > 0 ? (this.recutStart / d) * 100 : 0;
  }

  endPct() {
    const d = this.videoDuration();
    return d > 0 ? (this.recutEnd / d) * 100 : 100;
  }

  currentPct() {
    const d = this.videoDuration();
    return d > 0 ? (this.currentTime() / d) * 100 : 0;
  }

  thumbLeft(pct: number): string {
    return `calc(8px + ${(pct / 100).toFixed(4)} * (100% - 16px))`;
  }

  thumbRight(pct: number): string {
    return `calc(8px + ${((100 - pct) / 100).toFixed(4)} * (100% - 16px))`;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getClip(id).subscribe({
      next: (c) => {
        this.clip.set({ ...c, thumbnailUrl: this.api.getClipThumbnailUrl(c.id) });
        this.editTitle = c.title ?? '';
        this.editDescription = c.description ?? '';
        this.editRound = c.roundName ?? '';
        this.editPlayers = c.players ?? '';
        this.editScore = c.score ?? '';
        this.editPrivacy = c.privacyStatus ?? 'unlisted';
        this.recutStart = 0;
        this.recutEnd = 0; // will be set in onMetadata
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onMetadata() {
    const video = this.videoEl?.nativeElement;
    if (!video) return;
    const dur = video.duration;
    if (isFinite(dur)) {
      this.videoDuration.set(dur);
      this.recutEnd = dur;
    }
  }

  onTimeUpdate() {
    const video = this.videoEl?.nativeElement;
    if (video) this.currentTime.set(video.currentTime);
  }

  onTrackPointerDown(e: PointerEvent, track: HTMLElement) {
    const rect = track.getBoundingClientRect();
    const usableWidth = rect.width - 16; // account for 8px padding on each side
    const x = e.clientX - rect.left - 8;
    const pct = Math.max(0, Math.min(1, x / usableWidth));
    const val = pct * this.videoDuration();

    const distToStart = Math.abs(val - this.recutStart);
    const distToEnd = Math.abs(val - this.recutEnd);
    this.dragging = distToStart <= distToEnd ? 'start' : 'end';

    (track as any).setPointerCapture(e.pointerId);
    track.addEventListener('pointermove', this.onPointerMove);
    track.addEventListener('pointerup', this.onPointerUp);
    this.applyDrag(pct);
  }

  private onPointerMove = (e: PointerEvent) => {
    const track = (e.currentTarget as HTMLElement);
    const rect = track.getBoundingClientRect();
    const usableWidth = rect.width - 16;
    const x = e.clientX - rect.left - 8;
    const pct = Math.max(0, Math.min(1, x / usableWidth));
    this.applyDrag(pct);
  };

  private onPointerUp = (e: PointerEvent) => {
    const track = (e.currentTarget as HTMLElement);
    track.removeEventListener('pointermove', this.onPointerMove);
    track.removeEventListener('pointerup', this.onPointerUp);
    this.dragging = null;
  };

  private applyDrag(pct: number) {
    const dur = this.videoDuration();
    const val = pct * dur;
    if (this.dragging === 'start') {
      this.recutStart = Math.max(0, Math.min(val, this.recutEnd - 1));
      this.seekVideo(this.recutStart);
    } else if (this.dragging === 'end') {
      this.recutEnd = Math.max(this.recutStart + 1, Math.min(val, dur));
      this.seekVideo(this.recutEnd);
    }
  }

  onStartInput(event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      this.recutStart = Math.max(0, Math.min(val, this.recutEnd - 1));
      this.seekVideo(this.recutStart);
    }
  }

  onEndInput(event: Event) {
    const val = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      this.recutEnd = Math.max(this.recutStart + 1, Math.min(val, this.videoDuration()));
      this.seekVideo(this.recutEnd);
    }
  }

  seekVideo(time: number) {
    const video = this.videoEl?.nativeElement;
    if (video) video.currentTime = Math.max(0, time);
  }

  setRecutStartFromCurrent() {
    const t = this.currentTime();
    this.recutStart = Math.max(0, Math.min(t, this.recutEnd - 1));
  }

  setRecutEndFromCurrent() {
    const t = this.currentTime();
    if (t > this.recutStart) this.recutEnd = Math.min(t, this.videoDuration());
  }

  clipUrl(clip: Clip): string {
    return this.api.getClipStreamUrl(clip.id);
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + s.toString().padStart(2, '0');
  }

  formatDuration(seconds: number): string {
    return Math.round(seconds) + 's';
  }

  save() {
    this.saving.set(true);
    this.api.updateClip(this.clip()!.id, {
      title: this.editTitle || undefined,
      description: this.editDescription || undefined,
      roundName: this.editRound || undefined,
      players: this.editPlayers || undefined,
      score: this.editScore || undefined,
      privacyStatus: this.editPrivacy,
    }).subscribe({
      next: (c) => { this.clip.set(c); this.saving.set(false); this.successMsg.set('Sauvegarde OK'); setTimeout(() => this.successMsg.set(null), 2000); },
      error: () => this.saving.set(false),
    });
  }

  approve() {
    this.saving.set(true);
    this.api.updateClip(this.clip()!.id, { status: 'APPROVED' }).subscribe({
      next: (c) => { this.clip.set(c); this.saving.set(false); this.successMsg.set('Approuve ✓'); setTimeout(() => this.successMsg.set(null), 2000); },
      error: () => this.saving.set(false),
    });
  }

  disapprove() {
    this.saving.set(true);
    this.api.updateClip(this.clip()!.id, { status: 'PENDING' }).subscribe({
      next: (c) => { this.clip.set(c); this.saving.set(false); this.successMsg.set('Désapprouvé'); setTimeout(() => this.successMsg.set(null), 2000); },
      error: () => this.saving.set(false),
    });
  }

  recut() {
    const c = this.clip();
    if (!c) return;
    // Convert clip-file-relative offsets → VOD-absolute timestamps
    const vodStart = c.startSeconds + this.recutStart;
    const vodEnd = c.startSeconds + this.recutEnd;
    this.recutting.set(true);
    this.api.recutClip(c.id, vodStart, vodEnd).subscribe({
      next: (updated) => {
        this.clip.set(updated);
        this.recutting.set(false);
        this.successMsg.set('Recut termine ✓');
        setTimeout(() => this.successMsg.set(null), 3000);
        setTimeout(() => {
          const video = this.videoEl?.nativeElement;
          if (video) video.load();
          // Reset offsets for new clip
          this.recutStart = 0;
          this.recutEnd = 0;
          this.videoDuration.set(0);
        }, 500);
      },
      error: () => this.recutting.set(false),
    });
  }

  deleteClip() {
    if (!confirm('Supprimer ce clip définitivement ?')) return;
    const c = this.clip();
    if (!c) return;
    this.api.deleteClip(c.id).subscribe({
      next: () => this.router.navigate(['/vods', c.vodId]),
      error: (err) => alert(err?.error?.message ?? 'Erreur lors de la suppression'),
    });
  }

  onThumbFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const c = this.clip();
    if (!c) return;
    this.uploadingThumb.set(true);
    this.api.uploadClipThumbnail(c.id, file).subscribe({
      next: (updated) => {
        this.clip.set({ ...c, ...updated, thumbnailUrl: this.api.getClipThumbnailUrl(c.id) + '?t=' + Date.now() });
        this.uploadingThumb.set(false);
        this.thumbMsg.set('Miniature mise à jour ✓');
        setTimeout(() => this.thumbMsg.set(''), 3000);
      },
      error: () => this.uploadingThumb.set(false),
    });
  }

  statusClass(status: string): string {
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
