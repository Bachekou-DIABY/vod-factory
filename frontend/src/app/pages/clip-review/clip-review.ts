import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService, Clip } from '../../services/api.service';

@Component({
  selector: 'app-clip-review',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-950 text-white p-8">
      <a [routerLink]="['/vods', clip()?.vodId]" class="text-sm text-gray-500 hover:text-gray-300 mb-6 inline-block">← VOD</a>

      @if (loading()) {
        <p class="text-gray-400">Chargement...</p>
      } @else if (clip(); as c) {
        <div class="max-w-4xl">
          <div class="flex items-center justify-between mb-6">
            <h1 class="text-2xl font-bold">Set {{ c.setOrder }} — {{ c.roundName ?? 'Clip' }}</h1>
            <span class="px-3 py-1 rounded-full text-xs font-medium" [class]="statusClass(c.status)">
              {{ c.status }}
            </span>
          </div>

          @if (c.players) {
            <p class="text-gray-400 mb-6">{{ c.players }} — {{ c.score }}</p>
          }

          <!-- Player -->
          <video
            class="w-full rounded-xl mb-8 bg-black"
            controls
            preload="metadata"
            [src]="clipUrl(c)"
          ></video>

          <!-- Metadata edit -->
          <div class="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label class="block text-xs text-gray-500 mb-1">Titre</label>
              <input
                [(ngModel)]="editTitle"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                placeholder="Titre du clip"
              />
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-1">Round</label>
              <input
                [(ngModel)]="editRound"
                class="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                placeholder="Winners Finals"
              />
            </div>
          </div>

          <!-- Recut -->
          <div class="bg-gray-900 rounded-xl p-4 mb-6 border border-gray-800">
            <h3 class="text-sm font-medium mb-3 text-gray-300">Recut</h3>
            <div class="flex gap-4 items-end">
              <div>
                <label class="block text-xs text-gray-500 mb-1">Début (s)</label>
                <input
                  type="number"
                  [(ngModel)]="recutStart"
                  class="w-28 bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">Fin (s)</label>
                <input
                  type="number"
                  [(ngModel)]="recutEnd"
                  class="w-28 bg-gray-800 rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none"
                />
              </div>
              <button
                (click)="recut()"
                [disabled]="recutting()"
                class="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {{ recutting() ? 'Recut...' : 'Recut' }}
              </button>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-3">
            <button
              (click)="approve()"
              [disabled]="saving()"
              class="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Approuver
            </button>
            <button
              (click)="save()"
              [disabled]="saving()"
              class="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {{ saving() ? 'Sauvegarde...' : 'Sauvegarder' }}
            </button>
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
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  clip = signal<Clip | null>(null);
  loading = signal(true);
  saving = signal(false);
  recutting = signal(false);
  successMsg = signal<string | null>(null);

  editTitle = '';
  editRound = '';
  recutStart = 0;
  recutEnd = 0;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getClip(id).subscribe({
      next: (c) => {
        this.clip.set(c);
        this.editTitle = c.title ?? '';
        this.editRound = c.roundName ?? '';
        this.recutStart = c.startSeconds;
        this.recutEnd = c.endSeconds;
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  clipUrl(clip: Clip): string {
    return this.api.getClipStreamUrl(clip.id);
  }

  save() {
    this.saving.set(true);
    this.api.updateClip(this.clip()!.id, {
      title: this.editTitle || undefined,
      roundName: this.editRound || undefined,
    }).subscribe({
      next: (c) => { this.clip.set(c); this.saving.set(false); this.successMsg.set('Sauvegardé'); setTimeout(() => this.successMsg.set(null), 2000); },
      error: () => this.saving.set(false),
    });
  }

  approve() {
    this.saving.set(true);
    this.api.updateClip(this.clip()!.id, { status: 'APPROVED' }).subscribe({
      next: (c) => { this.clip.set(c); this.saving.set(false); this.successMsg.set('Approuvé ✓'); setTimeout(() => this.successMsg.set(null), 2000); },
      error: () => this.saving.set(false),
    });
  }

  recut() {
    this.recutting.set(true);
    this.api.recutClip(this.clip()!.id, this.recutStart, this.recutEnd).subscribe({
      next: (c) => { this.clip.set(c); this.recutting.set(false); this.successMsg.set('Recut terminé'); setTimeout(() => this.successMsg.set(null), 3000); },
      error: () => this.recutting.set(false),
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
