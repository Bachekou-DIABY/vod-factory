import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Tournament } from '../../services/api.service';

@Component({
  selector: 'app-tournaments',
  imports: [RouterLink],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <h1 class="text-3xl font-bold mb-8">Tournois</h1>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else if (error()) {
        <p class="text-red-400">{{ error() }}</p>
      } @else {
        <div class="grid gap-4">
          @for (t of tournaments(); track t.id) {
            <a
              [routerLink]="['/tournaments', t.slug]"
              class="block bg-gray-900 rounded-xl p-5 hover:bg-gray-800 transition-colors border border-gray-800"
            >
              <div class="font-semibold text-lg">{{ t.name }}</div>
              <div class="text-sm text-gray-400 mt-1">{{ t.slug }}</div>
            </a>
          } @empty {
            <p class="text-gray-500">Aucun tournoi importé.</p>
          }
        </div>
      }
    </div>
  `,
})
export class TournamentsPage implements OnInit {
  private readonly api = inject(ApiService);

  tournaments = signal<Tournament[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    this.api.getTournaments().subscribe({
      next: (data) => { this.tournaments.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e.message); this.loading.set(false); },
    });
  }
}
