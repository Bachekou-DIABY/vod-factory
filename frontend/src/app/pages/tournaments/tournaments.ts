import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Tournament, StartGGTournamentResult, YoutubeAccount, StorageInfo } from '../../services/api.service';
import { IconComponent } from '../../components/icon';

@Component({
  selector: 'app-tournaments',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <main class="px-6 lg:px-10 py-10 max-w-[1440px] mx-auto flex flex-col xl:flex-row gap-8 items-start">

      <div class="flex-1 min-w-0 w-full flex flex-col gap-6">
        <h1 class="text-4xl font-bold">Tournois</h1>

        <!-- Import -->
        <section class="card p-5 flex flex-col gap-3" aria-labelledby="titre-import">
          <label id="titre-import" for="recherche-tournoi" class="label !mb-0">Importer un tournoi</label>
          <div class="relative">
            <input
              id="recherche-tournoi"
              [(ngModel)]="query"
              (ngModelChange)="onQueryChange($event)"
              (keydown.enter)="importFromInput()"
              placeholder="Lien start.gg ou nom du tournoi"
              class="field w-full pr-28"
            />
            @if (searching()) {
              <span class="absolute right-3 top-3.5 text-gray-400 text-xs">Recherche…</span>
            }
          </div>

          @if (isUrl()) {
            <div class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
              <span class="text-sm text-gray-300 flex-1 truncate">Lien reconnu : <span class="text-gray-100 font-mono">{{ extractedSlug() }}</span></span>
              <button (click)="importSlug(extractedSlug())" [disabled]="importing() === extractedSlug()" class="btn btn-primary btn-sm">
                {{ importing() === extractedSlug() ? 'Import…' : 'Importer' }}
              </button>
            </div>
          }

          @if (searchResults().length) {
            <ul class="border border-gray-800 rounded-lg overflow-hidden divide-y divide-gray-800">
              @for (result of searchResults(); track result.id) {
                <li class="flex items-center justify-between gap-4 px-4 py-3 bg-gray-900">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">{{ result.name }}</div>
                    <div class="text-xs text-gray-400 mt-0.5">
                      {{ periode(result) }}
                      @if (lieu(result)) { · {{ lieu(result) }} }
                      @if (result.numAttendees) { · {{ result.numAttendees }} inscrits }
                    </div>
                  </div>
                  @if (alreadyImported(result.slug)) {
                    <span class="flex items-center gap-1.5 text-xs text-accent shrink-0">
                      <app-icon name="check" [size]="16" /> Importé
                    </span>
                  } @else {
                    <button (click)="importSlug(result.slug)" [disabled]="importing() === result.slug" class="btn btn-secondary btn-sm shrink-0">
                      {{ importing() === result.slug ? 'Import…' : 'Importer' }}
                    </button>
                  }
                </li>
              }
            </ul>
          }

          @if (importError()) {
            <p class="text-alert-text text-xs">{{ importError() }}</p>
          }
          @if (importSuccess()) {
            <p class="text-accent text-xs">{{ importSuccess() }}</p>
          }
        </section>

        <!-- Onglets -->
        <div role="group" aria-label="Filtrer les tournois" class="self-start flex bg-gray-900 border border-gray-800 rounded-lg p-1">
          <button (click)="activeTab.set('active')" [attr.aria-pressed]="activeTab() === 'active'"
            class="h-9 px-4 rounded-md text-sm transition-colors"
            [class]="activeTab() === 'active' ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100'">
            Actifs <span class="font-mono text-gray-400 ml-1">{{ tournaments().length }}</span>
          </button>
          <button (click)="switchToArchived()" [attr.aria-pressed]="activeTab() === 'archived'"
            class="h-9 px-4 rounded-md text-sm transition-colors"
            [class]="activeTab() === 'archived' ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100'">
            Archivés
            @if (archivedTournaments().length) { <span class="font-mono text-gray-400 ml-1">{{ archivedTournaments().length }}</span> }
          </button>
        </div>

        <!-- Liste -->
        @if (activeTab() === 'active') {
          @if (loading()) {
            <p class="text-gray-400 text-sm">Chargement…</p>
          } @else {
            <ul class="flex flex-col gap-3">
              @for (t of tournaments(); track t.id) {
                <li class="card group flex items-center gap-4 pr-4 hover:border-gray-700 transition-colors">
                  <a [routerLink]="['/tournaments', t.slug]" class="flex-1 min-w-0 flex items-center gap-4 px-6 py-5">
                    <span class="flex-1 min-w-0 flex flex-col gap-1">
                      <span class="text-xl font-semibold truncate">{{ t.name }}</span>
                      <span class="text-sm text-gray-400">
                        @if (t.startAt) { {{ dateLongue(t.startAt) }} · }<span class="font-mono">{{ t.slug }}</span>
                      </span>
                    </span>
                    <app-icon name="chevron-right" class="text-gray-400" />
                  </a>
                  <button (click)="archiveTournament(t)" [disabled]="archivingId() === t.id"
                    class="btn btn-secondary btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100" [attr.aria-label]="'Archiver ' + t.name">
                    <app-icon name="archive" [size]="16" />
                    {{ archivingId() === t.id ? '…' : 'Archiver' }}
                  </button>
                </li>
              } @empty {
                <li class="text-gray-400 text-sm">Aucun tournoi actif. Importe-en un ci-dessus.</li>
              }
            </ul>
          }
        }

        @if (activeTab() === 'archived') {
          @if (loadingArchived()) {
            <p class="text-gray-400 text-sm">Chargement…</p>
          } @else {
            <ul class="flex flex-col gap-3">
              @for (t of archivedTournaments(); track t.id) {
                <li class="card flex items-center gap-4 pr-4 border-dashed">
                  <a [routerLink]="['/tournaments', t.slug]" class="flex-1 min-w-0 px-6 py-4">
                    <span class="block text-base font-medium text-gray-300 truncate">{{ t.name }}</span>
                    <span class="block text-xs text-gray-400 font-mono mt-0.5">{{ t.slug }}</span>
                  </a>
                  <button (click)="unarchiveTournament(t)" [disabled]="archivingId() === t.id" class="btn btn-secondary btn-sm">
                    {{ archivingId() === t.id ? '…' : 'Restaurer' }}
                  </button>
                </li>
              } @empty {
                <li class="text-gray-400 text-sm">Aucun tournoi archivé.</li>
              }
            </ul>
          }
        }
      </div>

      <!-- Ressources -->
      <aside id="youtube" aria-labelledby="titre-ressources" class="w-full xl:w-[360px] shrink-0 flex flex-col gap-4 xl:mt-16">
        <h2 id="titre-ressources" class="eyebrow">Ressources</h2>

        @if (disque(); as d) {
          <section class="card p-5 flex flex-col gap-3">
            <div class="flex justify-between text-sm">
              <span>Disque du serveur</span>
              <span class="font-mono" [class]="d.critique ? 'text-alert-text' : ''">{{ d.utilise }} / {{ d.total }}</span>
            </div>
            <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div class="h-full" [class]="d.critique ? 'bg-alert' : 'bg-gray-100'" [style.width.%]="d.pct"></div>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">
              {{ d.libre }} libres. Une VOD de dix heures en demande près du double pendant son remux.
            </p>
          </section>
        }

        <section class="card p-5 flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Chaînes YouTube</span>
            <button (click)="connectYoutube()" [disabled]="connectingYoutube()" class="btn btn-youtube btn-sm">
              <app-icon name="plus" [size]="16" />
              {{ connectingYoutube() ? '…' : 'Connecter' }}
            </button>
          </div>

          @if (loadingAccounts()) {
            <p class="text-gray-400 text-sm">Chargement…</p>
          } @else if (youtubeAccounts().length === 0) {
            <p class="text-alert-text text-sm">Aucune chaîne connectée : les clips ne pourront pas être envoyés.</p>
          } @else {
            <ul class="flex flex-col gap-2">
              @for (account of youtubeAccounts(); track account.id) {
                <li class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {{ account.channelName[0] }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm truncate">{{ account.channelName }}</div>
                    <div class="text-xs text-accent">Connectée</div>
                  </div>
                  <button (click)="disconnectAccount(account.id)" [disabled]="disconnectingId() === account.id" class="btn btn-danger btn-sm">
                    {{ disconnectingId() === account.id ? '…' : 'Déconnecter' }}
                  </button>
                </li>
              }
            </ul>
          }

          <p class="text-xs text-gray-400 leading-relaxed border-t border-gray-800 pt-3">
            Une chaîne a son propre plafond de mises en ligne quotidien, indépendant du quota de l'API.
          </p>
        </section>
      </aside>

    </main>
  `,
})
export class TournamentsPage implements OnInit {
  private readonly api = inject(ApiService);

  tournaments = signal<Tournament[]>([]);
  loading = signal(true);
  activeTab = signal<'active' | 'archived'>('active');
  archivedTournaments = signal<Tournament[]>([]);
  loadingArchived = signal(false);
  archivingId = signal<string | null>(null);

  query = '';
  searchResults = signal<StartGGTournamentResult[]>([]);
  searching = signal(false);
  importing = signal('');
  importError = signal('');
  importSuccess = signal('');

  youtubeAccounts = signal<YoutubeAccount[]>([]);
  loadingAccounts = signal(true);
  connectingYoutube = signal(false);
  disconnectingId = signal<string | null>(null);

  private searchTimer: any;

  private readonly stockage = signal<StorageInfo | null>(null);
  readonly disque = computed(() => {
    const s = this.stockage();
    if (!s || s.totalBytes <= 0) return null;
    const go = (octets: number) => Math.round(octets / 1e9) + ' Go';
    return {
      pct: Math.round((s.usedBytes / s.totalBytes) * 100),
      utilise: go(s.usedBytes),
      total: go(s.totalBytes),
      libre: go(s.freeBytes),
      critique: s.freeBytes < 20e9,
    };
  });

  dateLongue(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  ngOnInit() {
    this.api.getStorage().subscribe({ next: (s) => this.stockage.set(s), error: () => undefined });
    this.api.getTournaments().subscribe({
      next: (data) => { this.tournaments.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.getYoutubeAccounts().subscribe({
      next: (accounts) => { this.youtubeAccounts.set(accounts); this.loadingAccounts.set(false); },
      error: () => this.loadingAccounts.set(false),
    });
  }

  connectYoutube() {
    this.connectingYoutube.set(true);
    this.api.getYoutubeAuthUrl().subscribe({
      next: ({ url }) => {
        this.connectingYoutube.set(false);
        window.open(url, '_blank', 'width=600,height=700');
        // Refresh accounts after a few seconds (user completes OAuth)
        setTimeout(() => {
          this.api.getYoutubeAccounts().subscribe((a) => this.youtubeAccounts.set(a));
        }, 5000);
      },
      error: () => this.connectingYoutube.set(false),
    });
  }

  disconnectAccount(id: string) {
    if (!confirm('Déconnecter cette chaîne YouTube ?')) return;
    this.disconnectingId.set(id);
    this.api.disconnectYoutubeAccount(id).subscribe({
      next: () => {
        this.youtubeAccounts.update((a) => a.filter((x) => x.id !== id));
        this.disconnectingId.set(null);
      },
      error: () => this.disconnectingId.set(null),
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

  switchToArchived() {
    this.activeTab.set('archived');
    if (this.archivedTournaments().length === 0) {
      this.loadingArchived.set(true);
      this.api.getArchivedTournaments().subscribe({
        next: (t) => { this.archivedTournaments.set(t); this.loadingArchived.set(false); },
        error: () => this.loadingArchived.set(false),
      });
    }
  }

  archiveTournament(t: Tournament) {
    this.archivingId.set(t.id);
    this.api.archiveTournament(t.id).subscribe({
      next: () => {
        this.tournaments.update(list => list.filter(x => x.id !== t.id));
        this.archivedTournaments.update(list => [t, ...list]);
        this.archivingId.set(null);
      },
      error: () => this.archivingId.set(null),
    });
  }

  unarchiveTournament(t: Tournament) {
    this.archivingId.set(t.id);
    this.api.unarchiveTournament(t.id).subscribe({
      next: () => {
        this.archivedTournaments.update(list => list.filter(x => x.id !== t.id));
        this.tournaments.update(list => [t, ...list]);
        this.archivingId.set(null);
      },
      error: () => this.archivingId.set(null),
    });
  }

  /** "12 – 14 sept. 2026", ou une seule date si le tournoi tient sur un jour. */
  periode(t: StartGGTournamentResult): string {
    if (!t.startAt) return 'date inconnue';
    const debut = new Date(t.startAt * 1000);
    const fin = t.endAt ? new Date(t.endAt * 1000) : null;
    const jour: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    if (!fin || debut.toDateString() === fin.toDateString()) {
      return debut.toLocaleDateString('fr-FR', { ...jour, year: 'numeric' });
    }
    return `${debut.toLocaleDateString('fr-FR', jour)} – ${fin.toLocaleDateString('fr-FR', { ...jour, year: 'numeric' })}`;
  }

  /** "Sandusky, US", ou "en ligne". Vide si Start.gg ne renseigne rien. */
  lieu(t: StartGGTournamentResult): string {
    if (t.isOnline) return 'en ligne';
    return [t.city, t.countryCode].filter(Boolean).join(', ');
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
