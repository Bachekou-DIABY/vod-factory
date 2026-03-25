import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-youtube-connected',
  imports: [RouterLink],
  template: `
    <div class="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
      <div class="text-center max-w-md">
        <div class="text-6xl mb-6">✅</div>
        <h1 class="text-2xl font-bold mb-3">YouTube connecté !</h1>
        <p class="text-gray-400 mb-8">Ton compte Google est autorisé. Tu peux maintenant uploader les clips directement depuis l'app.</p>
        <a [routerLink]="['/']"
          class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium transition-colors">
          Retour à l'accueil
        </a>
      </div>
    </div>
  `,
})
export class YoutubeConnectedPage {}
