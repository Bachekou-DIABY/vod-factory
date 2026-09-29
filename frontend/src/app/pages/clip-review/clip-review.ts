import { Component, inject, signal, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Clip } from '../../services/api.service';
import { IconComponent } from '../../components/icon';
import { statutClip } from '../../components/vod-status';

@Component({
  selector: 'app-clip-review',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <main class="px-6 lg:px-10 py-8 max-w-[1440px] mx-auto flex flex-col gap-6">
      <a [routerLink]="['/vods', clip()?.vodId]" fragment="clips-section" class="self-start flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-100">
        <app-icon name="arrow-left" [size]="16" /> VOD
      </a>

      @if (loading()) {
        <p class="text-gray-400 text-sm">Chargement…</p>
      } @else if (clip(); as c) {
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <span class="eyebrow">Set {{ c.setOrder }}{{ c.roundName ? ' · ' + c.roundName : '' }}</span>
            <h1 class="text-4xl font-bold truncate">{{ c.players ?? c.title ?? 'Clip' }}</h1>
            @if (c.score) { <p class="text-sm text-gray-400">{{ c.score }}</p> }
          </div>
          <span class="text-sm font-medium" [class]="statutClipAffiche(c.status).classes">{{ statutClipAffiche(c.status).label }}</span>
        </div>

        <div class="flex flex-col xl:flex-row gap-6 items-start">
          <!-- Lecture et recoupe -->
          <div class="flex-1 min-w-0 w-full flex flex-col gap-4">
            <video #videoEl class="w-full aspect-video rounded-xl bg-black border border-gray-800" controls preload="metadata"
              [src]="api.getStreamUrl(c.vodId)" (loadedmetadata)="onMetadata(c)" (timeupdate)="onTimeUpdate()"></video>

            <section class="card p-5 flex flex-col gap-4" aria-labelledby="titre-recoupe-clip">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h2 id="titre-recoupe-clip" class="text-sm font-semibold">Bornes du clip</h2>
                  <p class="text-xs text-gray-400 mt-0.5">Pré-placées sur le début et la fin du set. Ajuste-les, puis recoupe.</p>
                </div>
                <span class="text-xs font-mono shrink-0">
                  {{ toHMS(recutStart) }} → {{ toHMS(recutEnd) }} <span class="text-gray-400">({{ toHMS(recutEnd - recutStart) }})</span>
                </span>
              </div>

              <div class="relative h-10 flex items-center cursor-pointer select-none" #sliderTrack (pointerdown)="onTrackPointerDown($event, sliderTrack)">
                <div class="absolute inset-x-2 h-2 bg-gray-700 rounded-full"></div>
                <div class="absolute h-2 bg-accent rounded-full pointer-events-none" [style.left]="thumbLeft(startPct())" [style.right]="thumbRight(endPct())"></div>
                @if (videoDuration() > 0) {
                  <div class="absolute w-px h-4 bg-white/50 pointer-events-none" [style.left]="thumbLeft(currentPct())"></div>
                }
                <div class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-accent -translate-x-1/2 z-10 pointer-events-none" [style.left]="thumbLeft(startPct())"></div>
                <div class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-accent -translate-x-1/2 z-10 pointer-events-none" [style.left]="thumbLeft(endPct())"></div>
              </div>

              <div class="flex flex-wrap items-end gap-3">
                <div>
                  <label for="clip-debut" class="label">Début</label>
                  <input id="clip-debut" type="text" [value]="toHMS(recutStart)" (change)="onStartInput($event)" class="field w-32 font-mono" placeholder="hh:mm:ss" />
                </div>
                <div>
                  <label for="clip-fin" class="label">Fin</label>
                  <input id="clip-fin" type="text" [value]="toHMS(recutEnd)" (change)="onEndInput($event)" class="field w-32 font-mono" placeholder="hh:mm:ss" />
                </div>
                <button (click)="seekVideo(recutStart)" class="btn btn-secondary btn-sm">Aller au début</button>
                <button (click)="seekVideo(recutEnd - 5)" class="btn btn-secondary btn-sm">Aller à la fin</button>
                <button (click)="setRecutStartFromCurrent()" class="btn btn-secondary btn-sm">Début ici</button>
                <button (click)="setRecutEndFromCurrent()" class="btn btn-secondary btn-sm">Fin ici</button>
              </div>

              <button (click)="recut()" [disabled]="recutting()" class="btn btn-primary self-start">
                <app-icon name="scissors" [size]="16" /> {{ recutting() ? 'Recoupe…' : 'Recouper le fichier' }}
              </button>
            </section>
          </div>

          <!-- Métadonnées -->
          <aside class="w-full xl:w-[440px] shrink-0 flex flex-col gap-4">
            <section class="card p-6 flex flex-col gap-4" aria-labelledby="titre-infos">
              <h2 id="titre-infos" class="text-xl font-semibold">Informations YouTube</h2>
              <div>
                <label for="edit-titre" class="label">Titre</label>
                <input id="edit-titre" [(ngModel)]="editTitle" class="field w-full" placeholder="Titre du clip" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="edit-round" class="label">Round</label>
                  <input id="edit-round" [(ngModel)]="editRound" class="field w-full" placeholder="Winners Final" />
                </div>
                <div>
                  <label for="edit-score" class="label">Score</label>
                  <input id="edit-score" [(ngModel)]="editScore" class="field w-full" placeholder="3 - 1" />
                </div>
              </div>
              <div>
                <label for="edit-joueurs" class="label">Joueurs</label>
                <input id="edit-joueurs" [(ngModel)]="editPlayers" class="field w-full" placeholder="Joueur 1 vs Joueur 2" />
              </div>
              <div>
                <label for="edit-desc" class="label">Description <span class="text-gray-500">(générée si vide)</span></label>
                <textarea id="edit-desc" [(ngModel)]="editDescription" rows="4" class="field h-auto py-2.5 w-full resize-none"
                  placeholder="Description qui apparaîtra sur YouTube"></textarea>
              </div>
              <div>
                <label for="edit-visi" class="label">Visibilité</label>
                <select id="edit-visi" [(ngModel)]="editPrivacy" class="field w-full">
                  <option value="unlisted">Non répertoriée</option>
                  <option value="public">Publique</option>
                  <option value="private">Privée</option>
                </select>
              </div>
              <div>
                <span class="label">Miniature personnalisée</span>
                <div class="flex items-center gap-3">
                  @if (clip()?.thumbnailUrl) {
                    <img [src]="clip()?.thumbnailUrl" alt="Miniature actuelle" class="w-28 aspect-video rounded-lg object-cover bg-gray-800" />
                  }
                  <label class="btn btn-secondary btn-sm cursor-pointer">
                    {{ uploadingThumb() ? 'Envoi…' : 'Choisir une image' }}
                    <input type="file" accept="image/*" class="sr-only" (change)="onThumbFile($event)" [disabled]="uploadingThumb()" />
                  </label>
                  @if (thumbMsg()) { <span class="text-xs text-accent">{{ thumbMsg() }}</span> }
                </div>
              </div>
              <button (click)="save()" [disabled]="saving()" class="btn btn-secondary">
                {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </section>

            <section class="card p-6 flex flex-col gap-3" aria-label="Décision">
              @if (clip()?.status !== 'APPROVED') {
                <button (click)="approve()" [disabled]="saving()" class="btn btn-primary">
                  <app-icon name="check" [size]="16" /> Approuver pour YouTube
                </button>
              } @else {
                <button (click)="disapprove()" [disabled]="saving()" class="btn btn-secondary">Retirer l'approbation</button>
              }
              <div class="flex gap-3">
                <a [href]="api.getClipDownloadUrl(clip()!.id)" target="_blank" class="btn btn-secondary flex-1">
                  <app-icon name="download" [size]="16" /> Télécharger
                </a>
                <button (click)="deleteClip()" class="btn btn-danger flex-1">
                  <app-icon name="trash" [size]="16" /> Supprimer
                </button>
              </div>
              @if (successMsg()) { <p class="text-accent text-sm" role="status">{{ successMsg() }}</p> }
            </section>
          </aside>
        </div>
      }
    </main>
  `,
})
export class ClipReviewPage implements OnInit {
  readonly statutClipAffiche = statutClip;

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

  // VOD-absolute positions (seconds)
  recutStart = 0;
  recutEnd = 0;

  videoDuration = signal(0);
  currentTime = signal(0);

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

  /** Convert seconds to hh:mm:ss */
  toHMS(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  /** Parse hh:mm:ss or mm:ss or raw seconds → seconds */
  fromHMS(value: string): number {
    const trimmed = value.trim();
    const parts = trimmed.split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
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
        // Pre-position at set boundaries; onMetadata will also seek video there
        this.recutStart = c.startSeconds;
        this.recutEnd = c.endSeconds;
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onMetadata(c: Clip) {
    const video = this.videoEl?.nativeElement;
    if (!video) return;
    const dur = video.duration;
    if (isFinite(dur)) {
      this.videoDuration.set(dur);
      // If positions weren't set yet (edge case), fallback to full range
      if (this.recutEnd === 0) this.recutEnd = dur;
    }
    // Seek to set start so user sees the right moment immediately
    video.currentTime = this.recutStart;
  }

  onTimeUpdate() {
    const video = this.videoEl?.nativeElement;
    if (video) this.currentTime.set(video.currentTime);
  }

  onTrackPointerDown(e: PointerEvent, track: HTMLElement) {
    const rect = track.getBoundingClientRect();
    const usableWidth = rect.width - 16;
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
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const usableWidth = rect.width - 16;
    const x = e.clientX - rect.left - 8;
    const pct = Math.max(0, Math.min(1, x / usableWidth));
    this.applyDrag(pct);
  };

  private onPointerUp = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
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
    const val = this.fromHMS((event.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      this.recutStart = Math.max(0, Math.min(val, this.recutEnd - 1));
      this.seekVideo(this.recutStart);
    }
  }

  onEndInput(event: Event) {
    const val = this.fromHMS((event.target as HTMLInputElement).value);
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

  recut() {
    const c = this.clip();
    if (!c) return;
    // recutStart/recutEnd are already VOD-absolute
    this.recutting.set(true);
    this.api.recutClip(c.id, this.recutStart, this.recutEnd).subscribe({
      next: (updated) => {
        this.clip.set(updated);
        this.recutting.set(false);
        this.successMsg.set('Clip recoupé.');
        setTimeout(() => this.successMsg.set(null), 3000);
        setTimeout(() => {
          const video = this.videoEl?.nativeElement;
          if (video) video.load();
          this.recutStart = updated.startSeconds;
          this.recutEnd = updated.endSeconds;
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
      next: (c) => { this.clip.set(c); this.saving.set(false); this.successMsg.set('Clip approuvé.'); setTimeout(() => this.successMsg.set(null), 2000); },
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
        this.thumbMsg.set('Miniature mise à jour.');
        setTimeout(() => this.thumbMsg.set(''), 3000);
      },
      error: () => this.uploadingThumb.set(false),
    });
  }

}
