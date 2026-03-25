import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Tournament, StartGGTournamentResult } from '../../services/api.service';

@Component({
  selector: 'app-tournaments',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <h1 class="text-3xl font-bold mb-8">Tournois</h1>

      <!-- Search / Import -->
      <div class="mb-8">
        <div class="relative mb-2">
          <input
            [(ngModel)]="query"
            (ngModelChange)="onQueryChange($event)"
            (keydown.enter)="importFromInput()"
            placeholder="Rechercher un tournoi ou coller un lien start.gg…"
            class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          @if (searching()) {
            <span class="absolute right-3 top-3 text-gray-500 text-xs">Recherche...</span>
          }
        </div>

        <!-- URL import shortcut -->
        @if (isUrl()) {
          <div class="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
            <span class="text-sm text-gray-300 flex-1 truncate">Slug détecté : <span class="text-white font-mono">{{ extractedSlug() }}</span></span>
            <button
              (click)="importSlug(extractedSlug())"
              [disabled]="importing() === extractedSlug()"
              class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              {{ importing() === extractedSlug() ? 'Import...' : 'Importer' }}
            </button>
          </div>
        }

        <!-- Search results -->
        @if (searchResults().length) {
          <div class="mt-2 border border-gray-700 rounded-xl overflow-hidden">
            @for (result of searchResults(); track result.id) {
              <div class="flex items-center justify-between px-4 py-3 bg-gray-900 hover:bg-gray-800 border-b border-gray-800 last:border-0">
                <div>
                  <div class="text-sm font-medium">{{ result.name }}</div>
                  <div class="text-xs text-gray-500 font-mono">{{ result.slug }}</div>
                </div>
                <button
                  (click)="importSlug(result.slug)"
                  [disabled]="importing() === result.slug || alreadyImported(result.slug)"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ml-4"
                  [class]="alreadyImported(result.slug)
                    ? 'bg-green-900 text-green-400 cursor-default'
                    : 'bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white'"
                >
                  {{ alreadyImported(result.slug) ? '✓ Importé' : importing() === result.slug ? 'Import...' : 'Importer' }}
                </button>
              </div>
            }
          </div>
        }

        @if (importError()) {
          <p class="text-red-400 text-xs mt-2">{{ importError() }}</p>
        }
        @if (importSuccess()) {
          <p class="text-green-400 text-xs mt-2">✓ {{ importSuccess() }}</p>
        }
      </div>

      <!-- Local tournaments list -->
      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else {
        <div>
          @if (tournaments().length) {
            <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Tournois importés</h2>
          }
          <div class="grid gap-3">
            @for (t of tournaments(); track t.id) {
              <a
                [routerLink]="['/tournaments', t.slug]"
                class="flex items-center justify-between bg-gray-900 rounded-xl p-4 hover:bg-gray-800 transition-colors border border-gray-800"
              >
                <div>
                  <div class="font-medium">{{ t.name }}</div>
                  <div class="text-xs text-gray-500 font-mono mt-0.5">{{ t.slug }}</div>
                </div>
                <span class="text-gray-600 text-lg">→</span>
              </a>
            } @empty {
              <p class="text-gray-500 text-sm">Aucun tournoi importé. Recherche-en un ci-dessus.</p>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class TournamentsPage implements OnInit {
  private readonly api = inject(ApiService);

  tournaments = signal<Tournament[]>([]);
  loading = signal(true);

  query = '';
  searchResults = signal<StartGGTournamentResult[]>([]);
  searching = signal(false);
  importing = signal('');
  importError = signal('');
  importSuccess = signal('');

  private searchTimer: any;

  ngOnInit() {
    this.api.getTournaments().subscribe({
      next: (data) => { this.tournaments.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  isUrl() {
    return this.query.includes('start.gg/tournament/');
  }

  extractedSlug() {
    const match = this.query.match(/tournament\/([^/?#]+)/);
    return match?.[1] ?? '';
  }

  alreadyImported(slug: string) {
    return this.tournaments().some((t) => t.slug === slug);
  }

  onQueryChange(value: string) {
    this.importError.set('');
    this.importSuccess.set('');
    clearTimeout(this.searchTimer);
    if (this.isUrl() || !value.trim() || value.length < 3) {
      this.searchResults.set([]);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => {
      this.api.searchStartGGTournaments(value.trim()).subscribe({
        next: (results) => { this.searchResults.set(results); this.searching.set(false); },
        error: () => this.searching.set(false),
      });
    }, 400);
  }

  importFromInput() {
    const slug = this.isUrl() ? this.extractedSlug() : this.query.trim();
    if (slug) this.importSlug(slug);
  }

  importSlug(slug: string) {
    if (!slug || this.importing()) return;
    this.importing.set(slug);
    this.importError.set('');
    this.importSuccess.set('');
    this.api.importTournament(slug).subscribe({
      next: ({ data }) => {
        this.importing.set('');
        this.importSuccess.set(`"${data.name}" importé avec succès`);
        this.searchResults.set([]);
        this.query = '';
        this.api.getTournaments().subscribe((t) => this.tournaments.set(t));
      },
      error: (err) => {
        this.importing.set('');
        this.importError.set(err?.error?.message ?? `Erreur lors de l'import de "${slug}"`);
      },
    });
  }
}
