import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Tournament, Vod } from '../../services/api.service';

@Component({
  selector: 'app-tournament-detail',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a routerLink="/" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← Tournois</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else {
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-2xl font-bold">{{ tournament()?.name ?? slug }}</h1>
          <button
            (click)="showAddForm.set(!showAddForm())"
            class="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors"
          >
            + Ajouter VOD
          </button>
        </div>

        @if (showAddForm()) {
          <div class="mb-6 bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 class="text-sm font-semibold text-gray-300 mb-4">Nouvelle VOD</h2>
            <div class="flex gap-3 flex-wrap">
              <input
                [(ngModel)]="newVodUrl"
                placeholder="URL Twitch ou YouTube"
                class="flex-1 min-w-64 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                [(ngModel)]="newVodEventId"
                placeholder="eventStartGGId (optionnel)"
                class="w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                [(ngModel)]="newVodStreamName"
                placeholder="streamName (optionnel)"
                class="w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                (click)="addVod()"
                [disabled]="!newVodUrl || addingVod()"
                class="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {{ addingVod() ? 'Ajout...' : 'Ajouter' }}
              </button>
            </div>
            @if (addError()) {
              <p class="text-red-400 text-xs mt-2">{{ addError() }}</p>
            }
          </div>
        }

        <div class="grid gap-4">
          @for (vod of vods(); track vod.id) {
            <a
              [routerLink]="['/vods', vod.id]"
              class="block bg-gray-900 rounded-xl p-5 hover:bg-gray-800 transition-colors border border-gray-800"
            >
              <div class="flex items-center justify-between">
                <div class="truncate max-w-xl text-sm text-gray-300">{{ vod.sourceUrl }}</div>
                <span class="ml-4 shrink-0 px-3 py-1 rounded-full text-xs font-medium"
                  [class]="statusClass(vod.status)">{{ vod.status }}</span>
              </div>
              @if (vod.streamName) {
                <div class="text-xs text-gray-500 mt-1">Stream: {{ vod.streamName }}</div>
              }
            </a>
          } @empty {
            <p class="text-gray-500">Aucune VOD pour ce tournoi.</p>
          }
        </div>
      }
    </div>
  `,
})
export class TournamentDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  tournament = signal<Tournament | null>(null);
  vods = signal<Vod[]>([]);
  loading = signal(true);
  slug = '';

  showAddForm = signal(false);
  newVodUrl = '';
  newVodEventId = '';
  newVodStreamName = '';
  addingVod = signal(false);
  addError = signal('');

  ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug')!;
    this.api.getTournamentBySlug(this.slug).subscribe({
      next: (t) => {
        this.tournament.set(t);
        this.loadVods(t.id);
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
      next: () => {
        this.newVodUrl = '';
        this.newVodEventId = '';
        this.newVodStreamName = '';
        this.addingVod.set(false);
        this.showAddForm.set(false);
        this.loadVods(t.id);
      },
      error: (err) => {
        this.addError.set(err?.error?.message ?? 'Erreur lors de l\'ajout');
        this.addingVod.set(false);
      },
    });
  }

  statusClass(status: string): string {
    const map: Record<string, string> = {
      PENDING: 'bg-gray-700 text-gray-300',
      DOWNLOADING: 'bg-blue-900 text-blue-300',
      DOWNLOADED: 'bg-blue-700 text-blue-200',
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
