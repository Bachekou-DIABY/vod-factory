import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon';

@Component({
  selector: 'app-youtube-connected',
  imports: [RouterLink, IconComponent],
  template: `
    <main class="min-h-[calc(100vh-4rem)] flex items-center justify-center p-8">
      <div class="card p-10 max-w-md text-center flex flex-col items-center gap-4">
        <span class="w-14 h-14 rounded-full bg-accent text-accent-ink flex items-center justify-center">
          <app-icon name="check" [size]="28" />
        </span>
        <h1 class="text-2xl font-bold">Chaîne YouTube connectée</h1>
        <p class="text-gray-400">Ton compte Google est autorisé. Tu peux maintenant envoyer les clips depuis l'application.</p>
        <a [routerLink]="['/']" class="btn btn-primary mt-2">Retour à l'accueil</a>
      </div>
    </main>
  `,
})
export class YoutubeConnectedPage {}
