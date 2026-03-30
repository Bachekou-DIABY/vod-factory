import { Component, inject, signal, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Vod, Clip, ClipPlan } from '../../services/api.service';

@Component({
  selector: 'app-vod-detail',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a [routerLink]="vod()?.tournamentSlug ? ['/tournaments', vod()!.tournamentSlug] : ['/']"
        class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← Tournoi</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else if (vod(); as v) {
        <div class="flex items-start justify-between mb-6">
          <div class="flex-1 min-w-0 mr-4">
            <!-- Editable name -->
            <div class="flex items-center gap-2 mb-1">
              @if (editingName()) {
                <input #nameInput
                  [(ngModel)]="editNameValue"
                  (blur)="saveName()"
                  (keydown.enter)="saveName()"
                  (keydown.escape)="editingName.set(false)"
                  class="text-2xl font-bold bg-transparent border-b border-purple-500 outline-none w-full"
                  autofocus
                />
              } @else {
                <h1 class="text-2xl font-bold truncate max-w-2xl cursor-pointer hover:text-gray-300"
                  (click)="startEditName(v)">
                  {{ v.name || v.sourceUrl }}
                </h1>
                @if (!v.name) {
                  <span class="text-xs text-gray-600 shrink-0">cliquer pour nommer</span>
                }
              }
            </div>
            <span class="inline-block px-3 py-1 rounded-full text-xs font-medium"
              [class]="statusClass(v.status)">{{ v.status }}</span>
          </div>
          <div class="flex gap-2 shrink-0 ml-4">
            @if (v.filePath) {
              <button
                (click)="remux()"
                [disabled]="remuxing() || v.status === 'PROCESSING'"
                class="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-yellow-100 rounded-lg text-xs font-medium transition-colors"
                title="Corrige le fichier pour qu'il soit lisible directement dans le navigateur (moov atom faststart)"
              >
                {{ remuxing() || v.status === 'PROCESSING' ? 'Correction en cours...' : '🔧 Corriger le format' }}
              </button>
              <button
                (click)="deleteSourceFile()"
                [disabled]="deletingSourceFile()"
                class="px-3 py-1.5 bg-orange-900 hover:bg-orange-700 disabled:opacity-50 text-orange-300 rounded-lg text-xs font-medium transition-colors"
                title="Libère l'espace disque en supprimant la VOD source (les clips générés sont conservés)"
              >
                {{ deletingSourceFile() ? 'Suppression...' : '🗑️ Supprimer fichier source' }}
              </button>
            }
            <button
              (click)="deleteVod()"
              class="px-3 py-1.5 bg-red-900 hover:bg-red-700 text-red-300 rounded-lg text-xs font-medium transition-colors"
            >
              Supprimer la VOD
            </button>
          </div>
        </div>

        <!-- Download progress bar -->
        @if (v.status === 'DOWNLOADING') {
          <div class="mb-6 bg-gray-900 border border-gray-800 rounded-xl p-4 max-w-xl">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm text-blue-300">Téléchargement en cours...</span>
              <div class="flex items-center gap-3">
                @if (downloadProgress() !== null) {
                  <span class="text-sm font-mono text-blue-400">{{ downloadProgress() }}%</span>
                }
                <button
                  (click)="retryDownload()"
                  [disabled]="retryingDownload()"
                  class="px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-gray-300 transition-colors"
                  title="Relancer si bloqué à 0%"
                >
                  {{ retryingDownload() ? '...' : '↺ Relancer' }}
                </button>
              </div>
            </div>
            <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div class="h-2 bg-blue-500 rounded-full transition-all duration-500"
                [style.width]="(downloadProgress() ?? 0) + '%'"></div>
            </div>
          </div>
        }

        <!-- Video player -->
        @if (v.filePath) {
          <video
            #vodVideoEl
            class="w-full max-w-4xl rounded-xl mb-4 bg-black"
            controls
            preload="metadata"
            [src]="api.getStreamUrl(v.id)"
            (loadedmetadata)="onVodMetadata()"
            (timeupdate)="onVodTimeUpdate()"
          ></video>

          <!-- Manual clip section -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-8 max-w-4xl">
            <div class="flex items-center justify-between mb-1">
              <h3 class="text-sm font-semibold text-gray-200">Créer un clip manuellement</h3>
              @if (vodDuration() > 0) {
                <span class="text-xs text-gray-500 font-mono">
                  {{ formatTime(manualStart()) }} — {{ formatTime(manualEnd()) }}
                  <span class="text-gray-600 ml-1">({{ formatTime(manualEnd() - manualStart()) }})</span>
                </span>
              }
            </div>
            <p class="text-xs text-gray-500 mb-4">Sélectionne une portion de la VOD pour en faire un clip.</p>

            @if (vodDuration() > 0) {
              <!-- Dual-handle slider -->
              <div
                class="relative h-10 flex items-center mb-4 cursor-pointer select-none"
                #manualSlider
                (pointerdown)="onManualPointerDown($event, manualSlider)"
              >
                <div class="absolute inset-x-2 h-2 bg-gray-700 rounded-full"></div>
                <div
                  class="absolute h-2 bg-blue-600 rounded-full pointer-events-none"
                  [style.left]="thumbPos(manualStartPct())"
                  [style.right]="thumbPos(100 - manualEndPct())"
                ></div>
                <div
                  class="absolute w-px h-4 bg-white/40 pointer-events-none"
                  [style.left]="thumbPos(vodCurrentPct())"
                ></div>
                <div
                  class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-blue-500 -translate-x-1/2 z-10 pointer-events-none"
                  [style.left]="thumbPos(manualStartPct())"
                ></div>
                <div
                  class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-blue-400 -translate-x-1/2 z-10 pointer-events-none"
                  [style.left]="thumbPos(manualEndPct())"
                ></div>
              </div>

              <!-- Precise inputs -->
              <div class="flex gap-4 items-center flex-wrap mb-4">
                <div class="flex items-center gap-2">
                  <label class="text-xs text-gray-500 w-12 shrink-0">Début</label>
                  <input type="number" step="1" [value]="manualStart()" (change)="onManualStartInput($event)"
                    class="w-24 bg-gray-800 rounded-lg px-2 py-1 text-sm border border-gray-700 focus:border-blue-500 outline-none font-mono" />
                  <span class="text-xs text-gray-600">s</span>
                </div>
                <div class="flex items-center gap-2">
                  <label class="text-xs text-gray-500 w-12 shrink-0">Fin</label>
                  <input type="number" step="1" [value]="manualEnd()" (change)="onManualEndInput($event)"
                    class="w-24 bg-gray-800 rounded-lg px-2 py-1 text-sm border border-gray-700 focus:border-blue-500 outline-none font-mono" />
                  <span class="text-xs text-gray-600">s</span>
                </div>
                <button (click)="setManualStartFromCurrent()"
                  class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                  📍 → Début
                </button>
                <button (click)="setManualEndFromCurrent()"
                  class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
                  📍 → Fin
                </button>
              </div>

              <!-- Clip title + create button -->
              <div class="flex gap-3 items-center flex-wrap">
                <input [(ngModel)]="manualTitle" placeholder="Titre du clip (optionnel)"
                  class="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
                <button
                  (click)="createManualClip()"
                  [disabled]="creatingManualClip()"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors shrink-0"
                >
                  {{ creatingManualClip() ? 'Création...' : '+ Créer le clip' }}
                </button>
              </div>
              @if (manualClipMsg()) {
                <p class="text-green-400 text-xs mt-2">{{ manualClipMsg() }}</p>
              }
            } @else {
              <p class="text-xs text-gray-600">Charge la vidéo ci-dessus pour activer cette section.</p>
            }
          </div>
        }

        <!-- Import sets button -->
        <div class="flex gap-3 mb-6 flex-wrap">
          <button
            (click)="showImportSets.set(!showImportSets())"
            class="px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded-lg text-sm font-medium transition-colors"
          >
            ⚡ Importer les sets
          </button>
        </div>

        <!-- Import sets form -->
        @if (showImportSets()) {
          <div class="mb-8 bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 class="text-sm font-semibold text-gray-300 mb-4">Importer les sets depuis Start.gg</h2>
            <div class="bg-gray-800 rounded-lg p-4 mb-4 text-sm text-gray-300 leading-relaxed">
              <p class="font-medium text-white mb-2">Comment ça marche ?</p>
              <ul class="space-y-1 text-gray-400 list-disc list-inside">
                <li>Le système récupère les timestamps de chaque set sur Start.gg</li>
                <li>Il calcule la position de chaque set dans ta VOD et génère les clips automatiquement</li>
                <li>Si les clips sont décalés, renseigne l'heure de début du stream ci-dessous</li>
              </ul>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div class="col-span-2">
                <label class="block text-xs text-gray-400 mb-1">
                  Heure de début du stream
                  <span class="text-gray-600 ml-1">(optionnel — si les clips sont décalés)</span>
                </label>
                <div class="flex gap-2 items-center">
                  <input
                    type="number"
                    [(ngModel)]="importRecordedAt"
                    placeholder="ex: 1742654400 (laisser à 0 si inconnu)"
                    class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    (click)="fetchTimestamp()"
                    [disabled]="fetchingTimestamp() || (isLocalVod() && !timestampUrl.trim())"
                    class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-medium transition-colors shrink-0"
                    [title]="isLocalVod() && !timestampUrl.trim() ? 'Renseigne URL du stream ci-dessous' : 'Recuperer automatiquement depuis URL de la VOD'"
                  >
                    {{ fetchingTimestamp() ? '...' : '🔍 Auto' }}
                  </button>
                </div>
                @if (isLocalVod()) {
                  <div class="mt-2">
                    <label class="block text-xs text-gray-500 mb-1">
                      URL du stream original
                      <span class="text-gray-600 ml-1">(pour récupérer le timestamp automatiquement)</span>
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="timestampUrl"
                      placeholder="https://www.twitch.tv/videos/... ou YouTube"
                      class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    />
                    <p class="text-xs text-gray-600 mt-1">
                      Sans URL : renseigne le timestamp manuellement, ou utilise le recut clip par clip.
                    </p>
                  </div>
                }
              </div>
              <div>
                <label class="block text-xs text-gray-400 mb-1">
                  Marge avant chaque set
                  <span class="text-gray-600 ml-1">(secondes ajoutées avant le début)</span>
                </label>
                <input
                  type="number"
                  [(ngModel)]="importPreBuffer"
                  placeholder="30"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label class="block text-xs text-gray-400 mb-1">
                  Marge après chaque set
                  <span class="text-gray-600 ml-1">(secondes ajoutées après la fin)</span>
                </label>
                <input
                  type="number"
                  [(ngModel)]="importPostBuffer"
                  placeholder="30"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
            <div class="flex gap-3 items-center">
              <button
                (click)="importSets()"
                [disabled]="importingSets()"
                class="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {{ importingSets() ? 'Import en cours...' : 'Importer' }}
              </button>
              @if (importMsg()) {
                <span class="text-sm" [class]="importSuccess() ? 'text-green-400' : 'text-red-400'">{{ importMsg() }}</span>
              }
            </div>
          </div>
        }

        <!-- Clips -->
        @if (clips().length) {
          <div id="clips-section">
            <h2 class="text-xl font-semibold mb-4">Clips ({{ clips().length }})</h2>
            <div class="grid gap-3">
              @for (clip of clips(); track clip.id) {
                <div class="flex gap-4 bg-gray-900 rounded-lg p-4 border border-gray-800">
                  <a [routerLink]="['/clips', clip.id]" class="flex gap-4 flex-1 min-w-0 hover:opacity-80 transition-opacity">
                    <div class="shrink-0 w-32 rounded overflow-hidden bg-gray-800" style="height:72px">
                      <img
                        [src]="api.getClipThumbnailUrl(clip.id)"
                        class="w-full h-full object-cover"
                        loading="lazy"
                        (error)="$any($event.target).style.display='none'"
                      />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-1">
                        <div>
                          <span class="text-sm text-gray-500 mr-2">Set {{ clip.setOrder }}</span>
                          <span class="font-medium">{{ clip.roundName ?? 'Set ' + clip.setOrder }}</span>
                        </div>
                        <div class="flex items-center gap-3 text-sm shrink-0 ml-4">
                          <span class="text-gray-400">{{ formatDuration(clip.startSeconds, clip.endSeconds) }}</span>
                          <span class="px-2 py-0.5 rounded text-xs font-medium"
                            [class]="clipStatusClass(clip.status)">{{ clip.status }}</span>
                        </div>
                      </div>
                      @if (clip.players) {
                        <div class="text-sm text-gray-400">{{ clip.players }}</div>
                      }
                      @if (clip.score) {
                        <div class="text-xs text-gray-500 mt-0.5">{{ clip.score }}</div>
                      }
                    </div>
                  </a>
                  <div class="shrink-0 flex items-center gap-2 ml-2">
                    @if (clip.status === 'FAILED') {
                      <button
                        (click)="retryClip(clip.id)"
                        [disabled]="retryingClipId() === clip.id"
                        class="px-3 py-1.5 bg-red-900 hover:bg-red-700 disabled:opacity-50 text-red-300 rounded-lg text-xs font-medium transition-colors"
                        title="Relancer la génération de ce clip"
                      >
                        {{ retryingClipId() === clip.id ? '...' : '↺ Retry' }}
                      </button>
                    }
                    @if (clip.filePath) {
                      <a [href]="api.getClipDownloadUrl(clip.id)" target="_blank"
                        class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-medium transition-colors"
                        title="Télécharger le MP4">
                        ↓
                      </a>
                    }
                    <button
                      (click)="deleteClip($event, clip.id)"
                      [disabled]="deletingClipId() === clip.id"
                      class="px-3 py-1.5 bg-red-950 hover:bg-red-800 disabled:opacity-50 text-red-400 rounded-lg text-xs font-medium transition-colors"
                      title="Supprimer ce clip"
                    >
                      {{ deletingClipId() === clip.id ? '...' : '🗑' }}
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class VodDetailPage implements OnInit, OnDestroy {
  @ViewChild('vodVideoEl') vodVideoEl!: ElementRef<HTMLVideoElement>;

  protected readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  vod = signal<Vod | null>(null);
  clips = signal<Clip[]>([]);
  clipPlan = signal<ClipPlan | null>(null);
  loading = signal(true);
  remuxing = signal(false);
  deletingSourceFile = signal(false);
  editingName = signal(false);
  editNameValue = '';
  downloadProgress = signal<number | null>(null);
  retryingClipId = signal<string | null>(null);
  retryingDownload = signal(false);
  deletingClipId = signal<string | null>(null);
  fetchingTimestamp = signal(false);
  timestampUrl = '';

  showImportSets = signal(false);
  importingSets = signal(false);
  importRecordedAt = 0;
  importPreBuffer = 30;
  importPostBuffer = 30;
  importMsg = signal('');
  importSuccess = signal(false);

  // Manual clip
  vodDuration = signal(0);
  vodCurrentTime = signal(0);
  manualStart = signal(0);
  manualEnd = signal(0);
  manualTitle = '';
  creatingManualClip = signal(false);
  manualClipMsg = signal('');
  private manualDragging: 'start' | 'end' | null = null;

  isLocalVod(): boolean {
    const url = this.vod()?.sourceUrl ?? '';
    return url.startsWith('local:') || url.startsWith('/');
  }

  thumbPos(pct: number): string {
    return `calc(8px + ${pct / 100} * (100% - 16px))`;
  }

  manualStartPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.manualStart() / d) * 100 : 0;
  }
  manualEndPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.manualEnd() / d) * 100 : 100;
  }
  vodCurrentPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.vodCurrentTime() / d) * 100 : 0;
  }

  private pollInterval: any = null;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getVod(id).subscribe({
      next: (v) => {
        this.vod.set(v);
        this.loading.set(false);
        this.startPollingIfNeeded(v.status, id);
      },
      error: () => this.loading.set(false),
    });
    this.api.getClips(id).subscribe({ next: (c) => this.clips.set(c) });
  }

  ngOnDestroy() { this.stopPolling(); }

  startEditName(v: Vod) {
    this.editNameValue = v.name ?? '';
    this.editingName.set(true);
  }

  saveName() {
    const v = this.vod();
    if (!v) return;
    this.editingName.set(false);
    const name = this.editNameValue.trim();
    if (name === (v.name ?? '')) return;
    this.api.updateVod(v.id, { name }).subscribe({
      next: (updated) => this.vod.set({ ...v, ...updated, tournamentSlug: v.tournamentSlug }),
    });
  }

  remux() {
    const v = this.vod();
    if (!v) return;
    this.remuxing.set(true);
    this.api.remuxVod(v.id).subscribe({
      next: () => {
        this.remuxing.set(false);
        // Backend sets status to PROCESSING → polling will pick it up
        this.vod.set({ ...v, status: 'PROCESSING' });
        this.startPollingIfNeeded('PROCESSING', v.id);
      },
      error: () => this.remuxing.set(false),
    });
  }

  private startPollingIfNeeded(status: string, id: string) {
    if (['DOWNLOADING', 'PROCESSING'].includes(status)) {
      this.pollInterval = setInterval(() => {
        this.api.getVod(id).subscribe((v) => {
          this.vod.set(v);
          if (v.status === 'DOWNLOADING') {
            this.api.getDownloadProgress(id).subscribe((p) => this.downloadProgress.set(p.progress));
          }
          if (!['DOWNLOADING', 'PROCESSING'].includes(v.status)) {
            this.downloadProgress.set(null);
            this.stopPolling();
            this.api.getClips(id).subscribe((c) => this.clips.set(c));
          }
        });
      }, 5000);
    }
  }

  private stopPolling() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }

  onVodMetadata() {
    const v = this.vodVideoEl?.nativeElement;
    if (!v) return;
    const dur = v.duration;
    if (isFinite(dur)) {
      this.vodDuration.set(dur);
      this.manualEnd.set(Math.min(300, dur)); // default to first 5 min
    }
  }

  onVodTimeUpdate() {
    const v = this.vodVideoEl?.nativeElement;
    if (v) this.vodCurrentTime.set(v.currentTime);
  }

  setManualStartFromCurrent() {
    const t = Math.floor(this.vodCurrentTime());
    this.manualStart.set(t);
    if (this.manualEnd() <= t) this.manualEnd.set(Math.min(t + 300, this.vodDuration()));
  }

  setManualEndFromCurrent() {
    const t = Math.floor(this.vodCurrentTime());
    if (t > this.manualStart()) this.manualEnd.set(t);
  }

  onManualPointerDown(e: PointerEvent, track: HTMLElement) {
    const rect = track.getBoundingClientRect();
    const usableWidth = rect.width - 16;
    const x = e.clientX - rect.left - 8;
    const pct = Math.max(0, Math.min(1, x / usableWidth));
    const val = pct * this.vodDuration();
    const distStart = Math.abs(val - this.manualStart());
    const distEnd = Math.abs(val - this.manualEnd());
    this.manualDragging = distStart <= distEnd ? 'start' : 'end';
    (track as any).setPointerCapture(e.pointerId);
    track.addEventListener('pointermove', this.onManualPointerMove);
    track.addEventListener('pointerup', this.onManualPointerUp);
    this.applyManualDrag(pct);
  }

  private onManualPointerMove = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left - 8) / (rect.width - 16)));
    this.applyManualDrag(pct);
  };

  private onManualPointerUp = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    track.removeEventListener('pointermove', this.onManualPointerMove);
    track.removeEventListener('pointerup', this.onManualPointerUp);
    this.manualDragging = null;
  };

  private applyManualDrag(pct: number) {
    const dur = this.vodDuration();
    const val = pct * dur;
    if (this.manualDragging === 'start') {
      this.manualStart.set(Math.max(0, Math.min(val, this.manualEnd() - 1)));
      const v = this.vodVideoEl?.nativeElement;
      if (v) v.currentTime = this.manualStart();
    } else if (this.manualDragging === 'end') {
      this.manualEnd.set(Math.max(this.manualStart() + 1, Math.min(val, dur)));
      const v = this.vodVideoEl?.nativeElement;
      if (v) v.currentTime = this.manualEnd();
    }
  }

  onManualStartInput(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val)) this.manualStart.set(Math.max(0, Math.min(val, this.manualEnd() - 1)));
  }

  onManualEndInput(e: Event) {
    const val = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(val)) this.manualEnd.set(Math.max(this.manualStart() + 1, Math.min(val, this.vodDuration())));
  }

  createManualClip() {
    const v = this.vod();
    if (!v) return;
    this.creatingManualClip.set(true);
    this.api.createManualClip(v.id, {
      startSeconds: Math.floor(this.manualStart()),
      endSeconds: Math.floor(this.manualEnd()),
      title: this.manualTitle || undefined,
    }).subscribe({
      next: () => {
        this.creatingManualClip.set(false);
        this.manualTitle = '';
        this.manualClipMsg.set('Clip en cours de génération...');
        setTimeout(() => {
          this.manualClipMsg.set('');
          this.api.getClips(v.id).subscribe((c) => this.clips.set(c));
        }, 4000);
      },
      error: () => this.creatingManualClip.set(false),
    });
  }

  retryDownload() {
    const v = this.vod();
    if (!v) return;
    this.retryingDownload.set(true);
    this.api.retryVodDownload(v.id).subscribe({
      next: () => {
        this.retryingDownload.set(false);
        this.downloadProgress.set(0);
        this.startPollingIfNeeded('DOWNLOADING', v.id);
      },
      error: () => this.retryingDownload.set(false),
    });
  }

  deleteClip(e: Event, clipId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Supprimer ce clip ?')) return;
    this.deletingClipId.set(clipId);
    this.api.deleteClip(clipId).subscribe({
      next: () => {
        this.deletingClipId.set(null);
        this.clips.update(c => c.filter(x => x.id !== clipId));
      },
      error: () => this.deletingClipId.set(null),
    });
  }

  fetchTimestamp() {
    const v = this.vod();
    if (!v) return;
    const url = this.isLocalVod() ? this.timestampUrl.trim() : undefined;
    if (this.isLocalVod() && !url) return;
    this.fetchingTimestamp.set(true);
    this.api.fetchVodTimestamp(v.id, url).subscribe({
      next: ({ timestamp }) => {
        this.importRecordedAt = timestamp;
        this.fetchingTimestamp.set(false);
      },
      error: () => this.fetchingTimestamp.set(false),
    });
  }

  retryClip(clipId: string) {
    this.retryingClipId.set(clipId);
    this.api.retryClip(clipId).subscribe({
      next: () => {
        this.retryingClipId.set(null);
        const id = this.vod()!.id;
        setTimeout(() => this.api.getClips(id).subscribe((c) => this.clips.set(c)), 1000);
      },
      error: () => this.retryingClipId.set(null),
    });
  }

  deleteSourceFile() {
    const v = this.vod();
    if (!v || !v.filePath) return;
    if (!confirm('Supprimer le fichier source de la VOD ? Les clips générés seront conservés.')) return;
    this.deletingSourceFile.set(true);
    this.api.deleteVodSourceFile(v.id).subscribe({
      next: () => {
        this.deletingSourceFile.set(false);
        this.vod.set({ ...v, filePath: undefined });
      },
      error: (err) => {
        this.deletingSourceFile.set(false);
        alert(err?.error?.message ?? 'Erreur lors de la suppression du fichier');
      },
    });
  }

  deleteVod() {
    if (!confirm('Supprimer cette VOD et tous ses clips ?')) return;
    const id = this.vod()!.id;
    this.api.deleteVod(id).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => alert(err?.error?.message ?? 'Erreur lors de la suppression'),
    });
  }

  importSets() {
    const v = this.vod();
    if (!v) return;
    this.importingSets.set(true);
    this.importMsg.set('');
    const body: any = {};
    if (this.importRecordedAt) body.vodRecordedAtUnix = this.importRecordedAt;
    if (this.importPreBuffer !== 30) body.preBufferSeconds = this.importPreBuffer;
    if (this.importPostBuffer !== 30) body.postBufferSeconds = this.importPostBuffer;
    this.api.generateClips(v.id, body).subscribe({
      next: (res) => {
        this.importingSets.set(false);
        this.importSuccess.set(true);
        this.importMsg.set('✓ ' + (res.enqueuedSets ?? 0) + ' clips en file');
        this.showImportSets.set(false);
        setTimeout(() => this.api.getClips(v.id).subscribe((c) => this.clips.set(c)), 3000);
      },
      error: (err) => {
        this.importingSets.set(false);
        this.importSuccess.set(false);
        this.importMsg.set(err?.error?.message ?? 'Erreur');
      },
    });
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    return m + ':' + s.toString().padStart(2, '0');
  }

  formatDuration(start: number, end: number): string {
    return Math.round((end - start) / 60) + ' min';
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      PENDING: 'bg-gray-700 text-gray-300',
      DOWNLOADING: 'bg-blue-900 text-blue-300',
      DOWNLOADED: 'bg-cyan-800 text-cyan-300',
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
