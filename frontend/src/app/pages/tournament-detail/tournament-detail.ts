import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Tournament, Vod, StartGGEvent } from '../../services/api.service';

@Component({
  selector: 'app-tournament-detail',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a routerLink="/" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← Tournois</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else {
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold">{{ tournament()?.name ?? slug }}</h1>
          <div class="flex gap-2">
            <a [routerLink]="['/tournaments', slug, 'approved']"
              class="px-4 py-2 bg-green-800 hover:bg-green-700 text-green-200 rounded-lg text-sm font-medium transition-colors">
              ✓ Clips approuvés
            </a>
            <button
              (click)="showAddForm.set(!showAddForm())"
              class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors"
            >
              + Importer VOD
            </button>
          </div>
        </div>


        <!-- Add VOD form -->
        @if (showAddForm()) {
          <div class="mb-8 bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 class="text-sm font-semibold text-gray-300 mb-1">Importer une VOD</h2>
            <p class="text-xs text-gray-500 mb-4">
              Associe une VOD à cet event Start.gg pour pouvoir générer des clips automatiquement.
              <span class="text-gray-600">Les clips sont calculés à partir des timestamps des sets.</span>
            </p>

            <!-- Mode toggle -->
            <div class="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1 w-fit">
              <button (click)="importMode.set('url')"
                [class]="importMode() === 'url' ? 'px-3 py-1.5 bg-gray-700 rounded text-sm font-medium text-white' : 'px-3 py-1.5 text-sm text-gray-400 hover:text-gray-300'">
                URL
              </button>
              <button (click)="importMode.set('file')"
                [class]="importMode() === 'file' ? 'px-3 py-1.5 bg-gray-700 rounded text-sm font-medium text-white' : 'px-3 py-1.5 text-sm text-gray-400 hover:text-gray-300'">
                Fichier local
              </button>
            </div>

            <div class="grid grid-cols-1 gap-3 mb-3">
              <!-- URL mode -->
              @if (importMode() === 'url') {
                <div>
                  <label class="block text-xs text-gray-500 mb-1">URL Twitch / YouTube</label>
                  <input
                    [(ngModel)]="newVodUrl"
                    placeholder="https://www.twitch.tv/videos/..."
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              }

              <!-- File mode -->
              @if (importMode() === 'file') {
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Fichier vidéo</label>
                  <p class="text-xs text-gray-600 mb-2">
                    Pour que les clips soient bien alignés, tu devras renseigner l'heure de début du stream
                    (timestamp Unix) dans la page de la VOD après import.
                  </p>
                  <div class="flex items-center gap-3">
                    <label class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                      Choisir un fichier
                      <input type="file" accept="video/*" class="hidden" (change)="onFileSelected($event)" />
                    </label>
                    @if (selectedFile()) {
                      <span class="text-sm text-gray-300 truncate max-w-xs">{{ selectedFile()!.name }}</span>
                      <span class="text-xs text-gray-500 shrink-0">{{ (selectedFile()!.size / 1024 / 1024 / 1024).toFixed(2) }} Go</span>
                    } @else {
                      <span class="text-sm text-gray-600">Aucun fichier sélectionné</span>
                    }
                  </div>
                  @if (uploadProgress() > 0 && uploadProgress() < 100) {
                    <div class="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div class="h-full bg-blue-500 transition-all" [style.width.%]="uploadProgress()"></div>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">Upload : {{ uploadProgress() }}%</p>
                  }
                </div>
              }

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Event Start.gg</label>
                  @if (loadingEvents()) {
                    <div class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500">Chargement...</div>
                  } @else if (events().length) {
                    <select
                      [(ngModel)]="newVodEventId"
                      class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">— Aucun event —</option>
                      @for (ev of events(); track ev.id) {
                        <option [value]="ev.id">{{ ev.name }}</option>
                      }
                    </select>
                  } @else {
                    <input
                      [(ngModel)]="newVodEventId"
                      placeholder="eventStartGGId"
                      class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  }
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">Stream Twitch (optionnel)</label>
                  <input
                    [(ngModel)]="newVodStreamName"
                    placeholder="ex: mon_stream"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div class="flex gap-3 items-center">
              <button
                (click)="importMode() === 'file' ? addVodFile() : addVod()"
                [disabled]="(importMode() === 'url' ? !newVodUrl : !selectedFile()) || addingVod()"
                class="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {{ addingVod() ? 'Import en cours...' : 'Ajouter' }}
              </button>
              @if (addError()) {
                <p class="text-red-400 text-xs">{{ addError() }}</p>
              }
            </div>
          </div>
        }

        <!-- VODs grouped by event -->
        @if (vodsByEvent().length === 0) {
          <p class="text-gray-500">Aucune VOD pour ce tournoi.</p>
        }

        @for (group of vodsByEvent(); track group.eventId) {
          <div class="mb-8">
            <!-- Event header -->
            <div class="flex items-center gap-3 mb-3">
              <h2 class="text-base font-semibold text-gray-200">
                {{ group.eventName }}
              </h2>
              <span class="text-xs text-gray-600 font-mono">id: {{ group.eventId }}</span>
              <div class="flex-1 h-px bg-gray-800"></div>
            </div>

            <!-- VODs in this event, grouped by stream -->
            @for (streamGroup of group.streams; track streamGroup.streamName) {
              @if (streamGroup.streamName) {
                <div class="text-xs text-gray-500 mb-2 ml-1">
                  📺 {{ streamGroup.streamName }}
                </div>
              }
              <div class="grid gap-3 mb-4">
                @for (vod of streamGroup.vods; track vod.id) {
                  <div class="flex items-center gap-2 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
                    <a
                      [routerLink]="['/vods', vod.id]"
                      class="flex-1 min-w-0 p-4"
                    >
                      <div class="flex items-center justify-between">
                        <div class="truncate max-w-xl text-sm text-gray-300">{{ vod.name || vod.sourceUrl }}</div>
                        <span class="ml-4 shrink-0 px-3 py-1 rounded-full text-xs font-medium"
                          [class]="statusClass(vod.status)">{{ vod.status }}</span>
                      </div>
                      @if (vod.streamName) {
                        <div class="text-xs text-gray-600 mt-1">{{ vod.streamName }}</div>
                      }
                    </a>
                    <button
                      (click)="deleteVod(vod.id)"
                      [disabled]="deletingVodId() === vod.id"
                      class="shrink-0 mr-3 px-2 py-1.5 bg-red-950 hover:bg-red-800 disabled:opacity-50 text-red-400 rounded-lg text-xs transition-colors"
                      title="Supprimer cette VOD"
                    >
                      {{ deletingVodId() === vod.id ? '...' : '🗑' }}
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class TournamentDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  tournament = signal<Tournament | null>(null);
  vods = signal<Vod[]>([]);
  events = signal<StartGGEvent[]>([]);
  loading = signal(true);
  loadingEvents = signal(false);
  slug = '';

  showAddForm = signal(false);
  importMode = signal<'url' | 'file'>('url');
  newVodUrl = '';
  newVodEventId = '';
  newVodStreamName = '';
  addingVod = signal(false);
  addError = signal('');
  selectedFile = signal<File | null>(null);
  uploadProgress = signal(0);
  deletingVodId = signal<string | null>(null);

  /** VODs regroupées par event puis par stream */
  vodsByEvent = computed(() => {
    const allVods = this.vods();
    const eventsMap = new Map(this.events().map((e) => [String(e.id), e.name]));

    // Collect unique eventIds preserving insertion order
    const eventIds = [...new Set(allVods.map((v) => v.eventStartGGId ?? '__none__'))];

    return eventIds.map((eventId) => {
      const eventVods = allVods.filter((v) => (v.eventStartGGId ?? '__none__') === eventId);
      const streamNames = [...new Set(eventVods.map((v) => v.streamName ?? ''))];

      return {
        eventId,
        eventName: eventId === '__none__'
          ? 'Sans event'
          : eventsMap.get(eventId) ?? `Event ${eventId}`,
        streams: streamNames.map((streamName) => ({
          streamName,
          vods: eventVods.filter((v) => (v.streamName ?? '') === streamName),
        })),
      };
    });
  });

  ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug')!;
    this.api.getTournamentBySlug(this.slug).subscribe({
      next: (t) => {
        this.tournament.set(t);
        this.loadVods(t.id);
        this.loadEvents();
      },
      error: () => this.loading.set(false),
    });
  }

  private loadVods(tournamentId: string) {
    this.api.getTournamentVods(tournamentId).subscribe({
      next: (v) => { this.vods.set(v); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private loadEvents() {
    this.loadingEvents.set(true);
    this.api.getStartGGEvents(this.slug).subscribe({
      next: ({ events }) => { this.events.set(events ?? []); this.loadingEvents.set(false); },
      error: () => this.loadingEvents.set(false),
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  addVod() {
    const t = this.tournament();
    if (!t || !this.newVodUrl) return;
    this.addingVod.set(true);
    this.addError.set('');
    this.api.addVod({
      sourceUrl: this.newVodUrl,
      tournamentId: t.id,
      eventStartGGId: this.newVodEventId || undefined,
      streamName: this.newVodStreamName || undefined,
    }).subscribe({
      next: (vod) => {
        this.addingVod.set(false);
        this.router.navigate(['/vods', vod.id]);
      },
      error: (err) => {
        this.addError.set(err?.error?.message ?? 'Erreur lors de l\'ajout');
        this.addingVod.set(false);
      },
    });
  }

  addVodFile() {
    const t = this.tournament();
    const file = this.selectedFile();
    if (!t || !file) return;
    this.addingVod.set(true);
    this.addError.set('');
    this.uploadProgress.set(0);
    this.api.uploadVodFile(file, {
      tournamentId: t.id,
      eventStartGGId: this.newVodEventId || undefined,
      streamName: this.newVodStreamName || undefined,
    }, (pct) => this.uploadProgress.set(pct)).subscribe({
      next: (vod) => {
        this.addingVod.set(false);
        this.uploadProgress.set(0);
        this.router.navigate(['/vods', vod.id]);
      },
      error: (err) => {
        this.addError.set(err?.error?.message ?? 'Erreur lors de l\'upload');
        this.addingVod.set(false);
        this.uploadProgress.set(0);
      },
    });
  }

  deleteVod(vodId: string) {
    if (!confirm('Supprimer cette VOD et tous ses clips ?')) return;
    this.deletingVodId.set(vodId);
    this.api.deleteVod(vodId).subscribe({
      next: () => {
        this.deletingVodId.set(null);
        this.vods.update(v => v.filter(x => x.id !== vodId));
      },
      error: () => this.deletingVodId.set(null),
    });
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      PENDING: 'bg-gray-700 text-gray-300',
      DOWNLOADING: 'bg-blue-900 text-blue-300',
      DOWNLOADED: 'bg-cyan-800 text-cyan-300',
      ANALYZING: 'bg-yellow-900 text-yellow-300',
      ANALYZED: 'bg-green-900 text-green-300',
      PROCESSING: 'bg-purple-900 text-purple-300',
      PROCESSED: 'bg-blue-700 text-blue-200',
      COMPLETED: 'bg-green-700 text-green-200',
      FAILED: 'bg-red-900 text-red-300',
    };
    return map[status] ?? 'bg-gray-700 text-gray-300';
  }
}
