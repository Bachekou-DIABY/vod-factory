import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Tournament, Vod, StartGGEvent } from '../../services/api.service';
import { IconComponent } from '../../components/icon';
import { statutVod } from '../../components/vod-status';

@Component({
  selector: 'app-tournament-detail',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <main class="px-6 lg:px-10 py-8 max-w-[1440px] mx-auto flex flex-col gap-6">
      <a routerLink="/" class="self-start flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-100">
        <app-icon name="arrow-left" [size]="16" /> Tournois
      </a>

      @if (loading()) {
        <p class="text-gray-400 text-sm">Chargement…</p>
      } @else {
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <span class="eyebrow">Tournoi</span>
            <h1 class="text-4xl font-bold truncate">{{ tournament()?.name ?? slug }}</h1>
          </div>
          <a [routerLink]="['/tournaments', slug, 'approved']" class="btn btn-secondary">
            <app-icon name="list" [size]="16" /> Clips approuvés
          </a>
          @if (tournament()?.youtubePlaylistId; as playlistId) {
            <a [href]="'https://www.youtube.com/playlist?list=' + playlistId" target="_blank" rel="noopener" class="btn btn-secondary">
              <app-icon name="youtube" [size]="16" /> Playlist
            </a>
          }
          <button (click)="showAddForm.set(!showAddForm())" class="btn btn-primary" [attr.aria-expanded]="showAddForm()">
            <app-icon name="plus" [size]="16" /> Importer une VOD
          </button>
        </div>

        <!-- Import d'une VOD -->
        @if (showAddForm()) {
          <section class="card p-6 flex flex-col gap-5" aria-labelledby="titre-ajout">
            <div class="flex flex-col gap-1">
              <h2 id="titre-ajout" class="text-xl font-semibold">Importer une VOD</h2>
              <p class="text-sm text-gray-400">
                Un lien Twitch est téléchargé par le serveur et calé automatiquement. YouTube bloque le serveur : pour une VOD YouTube, télécharge-la sur ton poste puis envoie le fichier.
              </p>
            </div>

            <div role="group" aria-label="Source de la VOD" class="self-start flex bg-gray-800 border border-gray-700 rounded-lg p-1">
              <button (click)="importMode.set('url')" [attr.aria-pressed]="importMode() === 'url'"
                class="h-9 px-4 rounded-md text-sm transition-colors"
                [class]="importMode() === 'url' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-100'">Lien</button>
              <button (click)="importMode.set('file')" [attr.aria-pressed]="importMode() === 'file'"
                class="h-9 px-4 rounded-md text-sm transition-colors"
                [class]="importMode() === 'file' ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-100'">Fichier</button>
            </div>

            @if (importMode() === 'url') {
              <div>
                <label for="vod-url" class="label">Lien de la VOD</label>
                <input id="vod-url" [(ngModel)]="newVodUrl" placeholder="https://www.twitch.tv/videos/…" class="field w-full" />
              </div>
            }

            @if (importMode() === 'file') {
              <div class="flex flex-col gap-4">
                <div>
                  <span class="label">Fichier vidéo</span>
                  <div class="flex items-center gap-3">
                    <label class="btn btn-secondary cursor-pointer">
                      Choisir un fichier
                      <input type="file" accept="video/*" class="sr-only" (change)="onFileSelected($event)" />
                    </label>
                    @if (selectedFile()) {
                      <span class="text-sm text-gray-100 truncate max-w-xs">{{ selectedFile()!.name }}</span>
                      <span class="text-xs text-gray-400 font-mono shrink-0">{{ (selectedFile()!.size / 1024 / 1024 / 1024).toFixed(2) }} Go</span>
                    } @else {
                      <span class="text-sm text-gray-400">Aucun fichier choisi</span>
                    }
                  </div>
                  @if (uploadProgress() > 0 && uploadProgress() < 100) {
                    <div class="mt-3 flex items-center gap-3">
                      <div class="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full bg-accent transition-all" [style.width.%]="uploadProgress()"></div>
                      </div>
                      <span class="text-xs text-gray-400 font-mono">{{ uploadProgress() }} %</span>
                    </div>
                  }
                </div>
                <div>
                  <label for="vod-stream-url" class="label">Lien du stream d'origine <span class="text-gray-500">(facultatif, pour caler l'heure de début)</span></label>
                  <input id="vod-stream-url" [(ngModel)]="fileSourceStreamUrl" placeholder="https://www.twitch.tv/videos/…" class="field w-full" />
                </div>
              </div>
            }

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="vod-event" class="label">Event Start.gg</label>
                @if (loadingEvents()) {
                  <div class="field flex items-center text-gray-400">Chargement…</div>
                } @else if (events().length) {
                  <select id="vod-event" [(ngModel)]="newVodEventId" class="field w-full">
                    <option value="">Aucun event</option>
                    @for (groupe of eventsParJeu(); track groupe.jeu) {
                      <optgroup [label]="groupe.jeu">
                        @for (ev of groupe.events; track ev.id) {
                          <option [value]="ev.id">{{ ev.name }}{{ ev.jour ? ' · ' + ev.jour : '' }}</option>
                        }
                      </optgroup>
                    }
                  </select>
                } @else {
                  <input id="vod-event" [(ngModel)]="newVodEventId" placeholder="Identifiant de l'event" class="field w-full" />
                }
              </div>
              <div>
                <label for="vod-stream" class="label">Chaîne sur Start.gg <span class="text-gray-500">(facultatif)</span></label>
                <input id="vod-stream" [(ngModel)]="newVodStreamName" placeholder="ex. NauBody" class="field w-full" />
              </div>
            </div>

            <div class="flex items-center gap-3">
              <button (click)="importMode() === 'file' ? addVodFile() : addVod()"
                [disabled]="(importMode() === 'url' ? !newVodUrl : !selectedFile()) || addingVod()"
                class="btn btn-primary">
                {{ addingVod() ? 'Import en cours…' : 'Importer' }}
              </button>
              <button (click)="showAddForm.set(false)" class="btn btn-secondary">Annuler</button>
              @if (addError()) {
                <p class="text-alert-text text-sm">{{ addError() }}</p>
              }
            </div>
          </section>
        }

        <!-- VODs par event -->
        @if (vodsByEvent().length === 0) {
          <p class="text-gray-400 text-sm">Aucune VOD pour ce tournoi.</p>
        }

        @for (group of vodsByEvent(); track group.eventId) {
          <section class="flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <h2 class="text-lg font-semibold">{{ group.eventName }}</h2>
              <span class="text-xs text-gray-400 font-mono">{{ group.eventId }}</span>
              <div class="flex-1 h-px bg-gray-800"></div>
            </div>

            @for (streamGroup of group.streams; track streamGroup.streamName) {
              @if (streamGroup.streamName) {
                <div class="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
                  <app-icon name="youtube" [size]="14" /> Chaîne {{ streamGroup.streamName }}
                </div>
              }
              <ul class="flex flex-col gap-3">
                @for (vod of streamGroup.vods; track vod.id) {
                  <li class="card flex items-center gap-2 hover:border-gray-700 transition-colors">
                    <a [routerLink]="['/vods', vod.id]" class="flex-1 min-w-0 flex items-center gap-4 px-5 py-4">
                      <span class="flex-1 min-w-0 truncate">{{ vod.name || vod.sourceUrl }}</span>
                      <span class="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium" [class]="statut(vod.status).classes">{{ statut(vod.status).label }}</span>
                      <app-icon name="chevron-right" class="text-gray-400" />
                    </a>
                    <button (click)="deleteVod(vod.id)" [disabled]="deletingVodId() === vod.id"
                      class="btn btn-danger btn-sm mr-3" [attr.aria-label]="'Supprimer ' + (vod.name || 'cette VOD')">
                      @if (deletingVodId() === vod.id) { … } @else { <app-icon name="trash" [size]="16" /> }
                    </button>
                  </li>
                }
              </ul>
            }
          </section>
        }
      }
    </main>
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
  fileSourceStreamUrl = '';
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

  /**
   * Regroupe les épreuves par jeu, comme le fait Start.gg. Une affiche multi-jeux
   * en compte facilement quarante, illisibles dans une liste plate. Le jour est
   * ajouté au libellé pour distinguer les épreuves d'un même jeu réparties sur
   * plusieurs journées.
   */
  eventsParJeu = computed(() => {
    const groupes = new Map<string, Array<StartGGEvent & { jour?: string }>>();

    for (const ev of this.events()) {
      const jeu = ev.videogameName?.trim() || 'Autres';
      const jour = ev.startAt
        ? new Date(ev.startAt).toLocaleDateString('fr-FR', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })
        : undefined;
      if (!groupes.has(jeu)) groupes.set(jeu, []);
      groupes.get(jeu)!.push({ ...ev, jour });
    }

    for (const liste of groupes.values()) {
      liste.sort((a, b) => {
        const da = a.startAt ? Date.parse(a.startAt) : Number.MAX_SAFE_INTEGER;
        const db = b.startAt ? Date.parse(b.startAt) : Number.MAX_SAFE_INTEGER;
        return da !== db ? da - db : a.name.localeCompare(b.name);
      });
    }

    return [...groupes.entries()]
      .map(([jeu, events]) => ({ jeu, events }))
      .sort((a, b) => a.jeu.localeCompare(b.jeu));
  });

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
      sourceStreamUrl: this.fileSourceStreamUrl || undefined,
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

  readonly statut = statutVod;

}
