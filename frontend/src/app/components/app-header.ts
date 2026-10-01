import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService, StorageInfo, YoutubeAccount } from '../services/api.service';

/** Barre commune à toutes les pages : marque, navigation, disque, chaîne. */
@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="h-16 px-6 lg:px-10 flex items-center gap-10 bg-gray-900 border-b border-gray-800">
      <a routerLink="/" class="flex items-center gap-2.5 shrink-0" aria-label="VOD·Factory, accueil">
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <rect x="2" y="7" width="26" height="16" rx="3" stroke="#3BCEB1" stroke-width="2" />
          <path d="M12 7v16M18 7v16" stroke="#3BCEB1" stroke-width="2" stroke-dasharray="3 2" />
        </svg>
        <span class="text-lg font-bold tracking-wide">VOD<span class="text-accent">·</span>FACTORY</span>
      </a>

      <nav aria-label="Navigation principale" class="flex gap-7 text-sm">
        <a routerLink="/" routerLinkActive="text-gray-100 font-semibold" [routerLinkActiveOptions]="{ exact: true }"
          class="text-gray-400 hover:text-gray-100 transition-colors">Tournois</a>
      </nav>

      <div class="flex-1"></div>

      @if (disque(); as d) {
        <div class="hidden md:flex items-center gap-2.5 text-xs text-gray-400" [title]="d.detail">
          <span>Disque</span>
          <div class="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div class="h-full rounded-full" [class]="d.critique ? 'bg-alert' : 'bg-gray-400'" [style.width.%]="d.pct"></div>
          </div>
          <span class="font-mono" [class]="d.critique ? 'text-alert-text' : 'text-gray-100'">{{ d.libre }} libres</span>
        </div>
      }

      @if (chaine(); as c) {
        <div class="flex items-center gap-2.5 text-sm">
          <div class="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-semibold">
            {{ c.initiales }}
          </div>
          <div class="hidden sm:flex flex-col leading-tight">
            <span>{{ c.nom }}</span>
            <span class="text-xs text-accent">Chaîne YouTube connectée</span>
          </div>
        </div>
      } @else if (comptesCharges()) {
        <a routerLink="/" fragment="youtube" class="text-xs text-alert-text">Aucune chaîne YouTube</a>
      }
    </header>
  `,
})
export class AppHeaderComponent implements OnInit {
  private readonly api = inject(ApiService);

  private readonly stockage = signal<StorageInfo | null>(null);
  private readonly comptes = signal<YoutubeAccount[]>([]);
  readonly comptesCharges = signal(false);

  readonly disque = computed(() => {
    const s = this.stockage();
    if (!s || s.totalBytes <= 0) return null;
    const go = (octets: number) => `${Math.round(octets / 1e9)} Go`;
    return {
      pct: Math.round((s.usedBytes / s.totalBytes) * 100),
      libre: go(s.freeBytes),
      // Sous 20 Go, un seul remux de VOD longue peut ne plus tenir.
      critique: s.freeBytes < 20e9,
      detail: `${go(s.usedBytes)} utilisés sur ${go(s.totalBytes)}`,
    };
  });

  readonly chaine = computed(() => {
    const c = this.comptes()[0];
    if (!c) return null;
    const initiales = c.channelName
      .split(/\s+/)
      .map((mot) => mot[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return { nom: c.channelName, initiales };
  });

  ngOnInit() {
    this.api.getStorage().subscribe({ next: (s) => this.stockage.set(s), error: () => undefined });
    this.api.getYoutubeAccounts().subscribe({
      next: (a) => { this.comptes.set(a); this.comptesCharges.set(true); },
      error: () => this.comptesCharges.set(true),
    });
  }
}
