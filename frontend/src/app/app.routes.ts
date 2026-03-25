import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/tournaments/tournaments').then((m) => m.TournamentsPage),
  },
  {
    path: 'tournaments/:slug/approved',
    loadComponent: () =>
      import('./pages/tournament-approved/tournament-approved').then((m) => m.TournamentApprovedPage),
  },
  {
    path: 'tournaments/:slug',
    loadComponent: () =>
      import('./pages/tournament-detail/tournament-detail').then((m) => m.TournamentDetailPage),
  },
  {
    path: 'vods/:id',
    loadComponent: () =>
      import('./pages/vod-detail/vod-detail').then((m) => m.VodDetailPage),
  },
  {
    path: 'clips/:id',
    loadComponent: () =>
      import('./pages/clip-review/clip-review').then((m) => m.ClipReviewPage),
  },
  {
    path: 'youtube-connected',
    loadComponent: () =>
      import('./pages/youtube-connected/youtube-connected').then((m) => m.YoutubeConnectedPage),
  },
  { path: '**', redirectTo: '' },
];
