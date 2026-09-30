import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon';
import { ApiService, Clip, Tournament, YoutubeAccount } from '../../services/api.service';

@Component({
  selector: 'app-tournament-approved',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <main class="px-6 lg:px-10 py-8 max-w-[1440px] mx-auto flex flex-col gap-6">
      <a [routerLink]="['/tournaments', slug]" class="self-start flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-100">
        <app-icon name="arrow-left" [size]="16" /> Tournoi
      </a>

      @if (loading()) {
        <p class="text-gray-400 text-sm">Chargement…</p>
      } @else {
        <!-- En-tête -->
        <div class="flex flex-wrap items-end gap-6">
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <span class="eyebrow">{{ tournament()?.name ?? slug }} · clips approuvés</span>
            <h1 class="text-4xl font-bold">
              {{ clips().length }} clip{{ clips().length > 1 ? 's' : '' }}
              @if (clips().length) { <span class="text-gray-400 font-normal">· {{ dureeCumulee() }}</span> }
            </h1>
          </div>

          @if (ytAuthenticated()) {
            <div class="card px-4 py-3 flex items-center gap-3">
              <app-icon name="list" class="text-gray-400" />
              <div class="flex flex-col min-w-0">
                <span class="text-sm truncate">Playlist {{ tournament()?.name }}</span>
                <span class="text-xs text-gray-400">
                  {{ tournament()?.youtubePlaylistId ? dejaEnLigne() + ' vidéo(s) en ligne' : 'Créée au premier envoi' }}
                </span>
              </div>
              @if (tournament()?.youtubePlaylistId; as playlistId) {
                <a [href]="'https://www.youtube.com/playlist?list=' + playlistId" target="_blank" rel="noopener"
                  class="btn btn-secondary btn-sm ml-2">
                  <app-icon name="external" [size]="14" /> Ouvrir
                </a>
                <button (click)="renommage.set(!renommage())" class="btn btn-secondary btn-sm" [attr.aria-expanded]="renommage()">Renommer</button>
                <button (click)="synchroniserPlaylist()" [disabled]="syncEnCours()" class="btn btn-secondary btn-sm"
                  title="Ajoute à la playlist les vidéos en ligne qui n'y sont pas, sans rien renvoyer">
                  <app-icon name="refresh" [size]="14" /> {{ syncEnCours() ? '…' : 'Synchroniser' }}
                </button>
              }
            </div>
          }
        </div>

        @if (renommage()) {
          <form (ngSubmit)="renommerPlaylist()" class="card p-4 flex flex-wrap items-end gap-3">
            <div class="flex-1 min-w-64">
              <label for="titre-playlist" class="label">Nouveau nom de la playlist</label>
              <input id="titre-playlist" [(ngModel)]="nouveauTitrePlaylist" name="titrePlaylist" class="field w-full" />
            </div>
            <button type="submit" [disabled]="!nouveauTitrePlaylist.trim() || renommageEnCours()" class="btn btn-primary">
              {{ renommageEnCours() ? 'Renommage…' : 'Renommer' }}
            </button>
            <button type="button" (click)="renommage.set(false)" class="btn btn-secondary">Annuler</button>
          </form>
        }

        <!-- Alertes -->
        @if (!ytAuthenticated()) {
          <div class="banner-alert">
            <app-icon name="alert" class="text-alert-text mt-0.5" />
            <div class="flex-1">
              <p class="text-sm font-semibold text-alert-text">Aucune chaîne YouTube connectée</p>
              <p class="text-sm">Connecte ta chaîne depuis l'accueil pour pouvoir envoyer les clips.</p>
            </div>
            <a routerLink="/" fragment="youtube" class="btn btn-youtube btn-sm shrink-0">Connecter</a>
          </div>
        }
        @if (plafondAtteint()) {
          <div class="banner-alert" role="status">
            <app-icon name="clock" class="text-alert-text mt-0.5" />
            <div class="flex-1">
              <p class="text-sm font-semibold text-alert-text">Plafond quotidien de la chaîne atteint</p>
              <p class="text-sm">{{ dejaEnLigne() }} vidéo(s) en ligne. Les {{ aEnvoyer() }} clips restants sont intacts : l'envoi reprendra au premier d'entre eux, un par un.</p>
            </div>
          </div>
        }

        @if (clips().length === 0) {
          <div class="card p-10 text-center flex flex-col gap-2">
            <p class="text-gray-300">Aucun clip approuvé pour ce tournoi.</p>
            <p class="text-sm text-gray-400">Approuve des clips depuis la page d'une VOD ou d'un clip pour les retrouver ici.</p>
          </div>
        } @else {
          <!-- Barre d'outils -->
          <div class="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Filtrer les clips" class="flex bg-gray-900 border border-gray-800 rounded-lg p-1">
              <button (click)="filtre.set('tous')" [attr.aria-pressed]="filtre() === 'tous'" class="h-9 px-3 rounded-md text-sm transition-colors"
                [class]="filtre() === 'tous' ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100'">
                Tous <span class="font-mono text-gray-400 ml-0.5">{{ clips().length }}</span>
              </button>
              <button (click)="filtre.set('enligne')" [attr.aria-pressed]="filtre() === 'enligne'" class="h-9 px-3 rounded-md text-sm transition-colors"
                [class]="filtre() === 'enligne' ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100'">
                En ligne <span class="font-mono text-gray-400 ml-0.5">{{ dejaEnLigne() }}</span>
              </button>
              <button (click)="filtre.set('aenvoyer')" [attr.aria-pressed]="filtre() === 'aenvoyer'" class="h-9 px-3 rounded-md text-sm transition-colors"
                [class]="filtre() === 'aenvoyer' ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100'">
                À envoyer <span class="font-mono text-gray-400 ml-0.5">{{ aEnvoyer() }}</span>
              </button>
            </div>
            <div class="flex-1"></div>
            <button (click)="downloadAll()" class="btn btn-secondary">
              <app-icon name="download" [size]="16" /> Tout télécharger
            </button>
            @if (ytAuthenticated() && dejaEnLigne() > 0) {
              <button (click)="ouvrir('visibilite')" [disabled]="publishing()" class="btn btn-secondary text-accent border-accent-deep">
                {{ publishing() ? 'Publication…' : 'Changer la visibilité · ' + dejaEnLigne() }}
              </button>
            }
            @if (ytAuthenticated() && hasUploadable()) {
              <button (click)="ouvrir('envoi')" [disabled]="uploadingAll()" class="btn btn-youtube">
                <app-icon name="youtube" [size]="16" />
                {{ uploadingAll() ? 'Envoi en cours…' : 'Envoyer les ' + aEnvoyer() + ' restants sur YouTube' }}
              </button>
            }
          </div>

          @if (uploadMsg()) {
            <p class="text-sm text-gray-300" role="status">{{ uploadMsg() }}</p>
          }

          <div class="flex flex-col xl:flex-row gap-6 items-start">
            <!-- Cartes -->
            <ul class="flex-1 min-w-0 w-full grid grid-cols-1 sm:grid-cols-2 gap-5" [class]="panneau() ? 'lg:grid-cols-2 2xl:grid-cols-3' : 'lg:grid-cols-3 2xl:grid-cols-4'">
              @for (clip of clipsFiltres(); track clip.id) {
                <li class="card overflow-hidden flex flex-col" [class]="clipEnCours()?.id === clip.id ? 'border-alert' : ''">
                  <a [routerLink]="['/clips', clip.id]" class="relative block aspect-video bg-gray-800">
                    <img [src]="api.getClipThumbnailUrl(clip.id)" alt="" class="w-full h-full object-cover" loading="lazy"
                      (error)="$any($event.target).style.display='none'" />
                    <span class="absolute right-2 bottom-2 px-1.5 py-0.5 bg-gray-950/90 rounded text-[11px] font-mono">{{ formatDuration(clip.startSeconds, clip.endSeconds) }}</span>
                  </a>
                  <div class="px-4 pt-3.5 pb-2 flex flex-col gap-1 flex-1">
                    <span class="text-xs text-gray-400 truncate">{{ clip.roundName ?? 'Set ' + clip.setOrder }}</span>
                    <a [routerLink]="['/clips', clip.id]" class="text-sm font-medium hover:text-accent line-clamp-2">{{ clip.players ?? clip.title ?? 'Set ' + clip.setOrder }}</a>
                    @if (clip.score) { <span class="text-xs text-gray-400 truncate">{{ clip.score }}</span> }
                  </div>
                  <div class="px-4 pb-4 pt-1 flex items-center gap-2">
                    @if (clip.status === 'UPLOADED') {
                      <span class="flex items-center gap-1.5 text-xs text-accent">
                        <span class="w-2 h-2 rounded-full bg-accent"></span>En ligne{{ clip.privacyStatus ? ' · ' + visibiliteLabel(clip.privacyStatus) : '' }}
                      </span>
                      <span class="flex-1"></span>
                      @if (clip.youtubeVideoId) {
                        <a [href]="'https://youtu.be/' + clip.youtubeVideoId" target="_blank" class="flex items-center gap-1 text-xs text-accent hover:text-accent-soft">
                          Voir <app-icon name="external" [size]="13" />
                        </a>
                      }
                    } @else if (clip.status === 'UPLOADING') {
                      <span class="flex items-center gap-2 text-xs text-accent">
                        <span class="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin"></span>Envoi…
                      </span>
                      <span class="flex-1"></span>
                    } @else {
                      <span class="flex items-center gap-1.5 text-xs" [class]="clip.status === 'FAILED' ? 'text-alert-text' : 'text-gray-400'">
                        <span class="w-2 h-2 rounded-full border-[1.5px]" [class]="clip.status === 'FAILED' ? 'border-alert-text' : 'border-gray-400'"></span>
                        {{ clip.status === 'FAILED' ? 'Échec de l’envoi' : 'À envoyer' }}
                      </span>
                      <span class="flex-1"></span>
                      @if (ytAuthenticated()) {
                        <button (click)="ouvrirFormulaireClip(clip)" class="btn btn-secondary btn-sm">
                          {{ clip.status === 'FAILED' ? 'Réessayer' : 'Envoyer…' }}
                        </button>
                      }
                    }
                    <a [href]="api.getClipDownloadUrl(clip.id)" target="_blank" class="btn btn-secondary btn-sm !px-2" aria-label="Télécharger le MP4">
                      <app-icon name="download" [size]="15" />
                    </a>
                  </div>
                </li>
              } @empty {
                <li class="text-sm text-gray-400">Aucun clip dans ce filtre.</li>
              }
            </ul>

            <!-- Panneau latéral -->
            @if (panneau(); as p) {
              <aside class="w-full xl:w-[400px] shrink-0 xl:sticky xl:top-6">

                @if (p === 'clip' && clipEnCours(); as c) {
                  <form (ngSubmit)="confirmerEnvoiClip()" class="card border-alert p-6 flex flex-col gap-4" aria-labelledby="titre-envoi-clip">
                    <div class="flex flex-col gap-1">
                      <h2 id="titre-envoi-clip" class="text-xl font-semibold">Envoyer ce clip</h2>
                      <span class="text-sm text-gray-400 truncate">{{ c.roundName }} · {{ c.players }}</span>
                    </div>
                    <div>
                      <label for="clip-titre" class="label">Titre</label>
                      <input id="clip-titre" name="clipTitre" type="text" [(ngModel)]="clipTitre" class="field w-full" />
                    </div>
                    <div>
                      <label for="clip-desc" class="label">Description</label>
                      <textarea id="clip-desc" name="clipDescription" [(ngModel)]="clipDescription" rows="5" class="field h-auto py-2.5 w-full resize-none leading-relaxed"></textarea>
                    </div>
                    <div>
                      <label for="clip-visi" class="label">Visibilité</label>
                      <select id="clip-visi" name="clipPrivacy" [(ngModel)]="clipPrivacy" class="field w-full">
                        <option value="unlisted">Non répertoriée</option>
                        <option value="private">Privée</option>
                        <option value="public">Publique</option>
                      </select>
                      <p class="text-xs text-gray-400 mt-1.5">Modifiable ensuite pour tous les clips à la fois, sans renvoyer les vidéos.</p>
                    </div>
                    <div class="flex gap-3 pt-1">
                      <button type="button" (click)="clipEnCours.set(null)" class="btn btn-secondary flex-1">Annuler</button>
                      <button type="submit" [disabled]="!clipTitre.trim()" class="btn btn-youtube flex-1">Envoyer sur YouTube</button>
                    </div>
                  </form>
                }

                @if (p === 'envoi') {
                  <form (ngSubmit)="uploadAll()" class="card border-alert p-6 flex flex-col gap-4" aria-labelledby="titre-envoi-lot">
                    <div class="flex flex-col gap-1">
                      <h2 id="titre-envoi-lot" class="text-xl font-semibold">Envoyer {{ aEnvoyer() }} clips</h2>
                      <span class="text-sm text-gray-400">Un par un. Chaque clip garde son titre et sa description.</span>
                    </div>
                    <div>
                      <label for="lot-visi" class="label">Visibilité des vidéos</label>
                      <select id="lot-visi" name="clipPrivacyLot" [(ngModel)]="clipPrivacy" class="field w-full">
                        <option value="unlisted">Non répertoriées</option>
                        <option value="private">Privées</option>
                        <option value="public">Publiques</option>
                      </select>
                    </div>
                    @if (!tournament()?.youtubePlaylistId) {
                      <div>
                        <label for="lot-playlist" class="label">Visibilité de la playlist</label>
                        <select id="lot-playlist" name="playlistPrivacy" [(ngModel)]="playlistPrivacy" class="field w-full">
                          <option value="unlisted">Non répertoriée</option>
                          <option value="private">Privée</option>
                          <option value="public">Publique</option>
                        </select>
                      </div>
                      <div>
                        <label for="lot-playlist-desc" class="label">Description de la playlist <span class="text-gray-500">(facultatif)</span></label>
                        <textarea id="lot-playlist-desc" name="playlistDescription" [(ngModel)]="playlistDescription" rows="3" class="field h-auto py-2.5 w-full resize-none"></textarea>
                      </div>
                    }
                    <p class="text-xs text-gray-400 leading-relaxed">
                      Si la chaîne atteint son plafond du jour, l'envoi s'arrête proprement et reprendra au premier clip restant.
                    </p>
                    <div class="flex gap-3 pt-1">
                      <button type="button" (click)="showPlaylistForm.set(false)" class="btn btn-secondary flex-1">Annuler</button>
                      <button type="submit" class="btn btn-youtube flex-1">Lancer l'envoi</button>
                    </div>
                  </form>
                }

                @if (p === 'visibilite') {
                  <form (ngSubmit)="appliquerVisibilite()" class="card border-accent-deep p-6 flex flex-col gap-4" aria-labelledby="titre-visibilite">
                    <div class="flex flex-col gap-1">
                      <h2 id="titre-visibilite" class="text-xl font-semibold">Changer la visibilité</h2>
                      <span class="text-sm text-gray-400 leading-relaxed">Porte sur les {{ dejaEnLigne() }} vidéo(s) déjà en ligne. Rien n'est renvoyé : le plafond de la chaîne ne s'applique pas.</span>
                    </div>
                    <div>
                      <label for="pub-visi" class="label">Nouvelle visibilité</label>
                      <select id="pub-visi" name="publishPrivacy" [(ngModel)]="publishPrivacy" class="field w-full">
                        <option value="public">Publique</option>
                        <option value="unlisted">Non répertoriée</option>
                        <option value="private">Privée</option>
                      </select>
                    </div>
                    <label class="flex items-center gap-2 text-sm text-gray-300">
                      <input type="checkbox" name="publishPlaylist" [(ngModel)]="publishPlaylist" class="w-4 h-4 accent-accent" />
                      Appliquer aussi à la playlist
                    </label>
                    <div class="flex gap-3 pt-1">
                      <button type="button" (click)="showPublishForm.set(false)" class="btn btn-secondary flex-1">Annuler</button>
                      <button type="submit" [disabled]="publishing()" class="btn btn-primary flex-1">Appliquer</button>
                    </div>
                  </form>
                }

              </aside>
            }
          </div>
        }
      }
    </main>
  `,
})
export class TournamentApprovedPage implements OnInit {
  protected readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  slug = '';
  tournament = signal<Tournament | null>(null);
  clips = signal<Clip[]>([]);
  loading = signal(true);
  youtubeAccounts = signal<YoutubeAccount[]>([]);
  uploadingAll = signal(false);
  uploadMsg = signal('');
  showPlaylistForm = signal(false);
  // Non repertorie par defaut : une erreur de titre ou de decoupe se corrige
  // tant que la video n est pas publique.
  playlistPrivacy = 'unlisted';
  playlistDescription = '';

  // Envoi d un clip isole : le formulaire est obligatoire, meme si l on se
  // contente des valeurs proposees.
  clipEnCours = signal<Clip | null>(null);
  clipTitre = '';
  clipDescription = '';
  clipPrivacy = 'unlisted';

  // Publication en lot des videos deja en ligne. Ne met rien en ligne, donc
  // echappe au plafond journalier de la chaine.
  showPublishForm = signal(false);
  publishing = signal(false);
  publishPrivacy = 'public';
  publishPlaylist = true;
  dejaEnLigne = () => this.clips().filter((c) => c.status === 'UPLOADED').length;

  /** Vrai dès qu'un envoi a été refusé par le plafond quotidien de la chaîne. */
  plafondAtteint = signal(false);
  filtre = signal<'tous' | 'enligne' | 'aenvoyer'>('tous');

  renommage = signal(false);
  renommageEnCours = signal(false);
  nouveauTitrePlaylist = '';
  syncEnCours = signal(false);

  readonly aEnvoyer = computed(
    () => this.clips().filter((c) => c.status !== 'UPLOADED' && c.status !== 'UPLOADING').length,
  );

  readonly clipsFiltres = computed(() => {
    const f = this.filtre();
    if (f === 'enligne') return this.clips().filter((c) => c.status === 'UPLOADED');
    if (f === 'aenvoyer') return this.clips().filter((c) => c.status !== 'UPLOADED');
    return this.clips();
  });

  readonly dureeCumulee = computed(() => {
    const s = this.clips().reduce((n, c) => n + (c.endSeconds - c.startSeconds), 0);
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? h + ' h ' + String(m).padStart(2, '0') + ' de jeu' : m + ' min de jeu';
  });

  /** Un seul panneau latéral à la fois : envoi d'un clip, envoi groupé ou visibilité. */
  readonly panneau = computed(() =>
    this.clipEnCours() ? 'clip' : this.showPlaylistForm() ? 'envoi' : this.showPublishForm() ? 'visibilite' : null,
  );

  ouvrir(p: 'envoi' | 'visibilite') {
    this.clipEnCours.set(null);
    this.showPlaylistForm.set(p === 'envoi');
    this.showPublishForm.set(p === 'visibilite');
  }

  visibiliteLabel(v: string): string {
    return ({ public: 'publique', unlisted: 'non répertoriée', private: 'privée' } as Record<string, string>)[v] ?? v;
  }

  renommerPlaylist() {
    const t = this.tournament();
    const titre = this.nouveauTitrePlaylist.trim();
    if (!t || !titre) return;
    this.renommageEnCours.set(true);
    this.api.renameTournamentPlaylist(t.id, { title: titre }).subscribe({
      next: () => {
        this.renommageEnCours.set(false);
        this.renommage.set(false);
        this.uploadMsg.set('Playlist renommée en « ' + titre + ' ».');
      },
      error: (err) => {
        this.renommageEnCours.set(false);
        this.uploadMsg.set('Renommage impossible : ' + (err.error?.message ?? err.message));
      },
    });
  }

  synchroniserPlaylist() {
    const t = this.tournament();
    if (!t) return;
    this.syncEnCours.set(true);
    this.api.syncTournamentPlaylist(t.id).subscribe({
      next: (r) => {
        this.syncEnCours.set(false);
        this.uploadMsg.set(
          r.ajoutes > 0 ? r.ajoutes + ' vidéo(s) ajoutée(s) à la playlist.' : 'La playlist contenait déjà toutes les vidéos en ligne.',
        );
      },
      error: (err) => {
        this.syncEnCours.set(false);
        this.uploadMsg.set('Synchronisation impossible : ' + (err.error?.message ?? err.message));
      },
    });
  }

  ytAuthenticated() {
    return this.youtubeAccounts().length > 0;
  }

  ngOnInit() {
    this.slug = this.route.snapshot.paramMap.get('slug')!;

    this.api.getYoutubeAccounts().subscribe({
      next: (accounts) => this.youtubeAccounts.set(accounts),
      error: () => {},
    });

    this.api.getTournamentBySlug(this.slug).subscribe({
      next: (t) => {
        this.tournament.set(t);
        this.api.getTournamentApprovedClips(t.id).subscribe({
          next: (clips) => { this.clips.set(clips); this.loading.set(false); },
          error: () => this.loading.set(false),
        });
      },
      error: () => this.loading.set(false),
    });
  }

  hasUploadable(): boolean {
    return this.clips().some(c => c.status !== 'UPLOADED' && c.status !== 'UPLOADING');
  }

  connectYoutube() {
    this.api.getYoutubeAuthUrl().subscribe({
      next: (r) => window.open(r.url, '_blank'),
      error: (err) => alert('Erreur: ' + (err.error?.message ?? err.message)),
    });
  }

  appliquerVisibilite() {
    const tournamentId = this.tournament()?.id;
    if (!tournamentId || this.publishing()) return;

    this.publishing.set(true);
    this.showPublishForm.set(false);
    this.uploadMsg.set('Changement de visibilite en cours...');

    this.api
      .setTournamentClipsVisibility(tournamentId, {
        privacyStatus: this.publishPrivacy,
        includePlaylist: this.publishPlaylist,
      })
      .subscribe({
        next: (r) => {
          this.publishing.set(false);
          const parts = [`${r.modifies} video(s) passee(s) en ${r.privacyStatus}`];
          if (r.inchanges > 0) parts.push(`${r.inchanges} deja conforme(s)`);
          if (r.playlist) parts.push('playlist incluse');
          if (r.echecs.length > 0) parts.push(`${r.echecs.length} echec(s)`);
          this.uploadMsg.set(parts.join(', ') + '.');
          const t = this.tournament();
          if (t) {
            this.api
              .getTournamentApprovedClips(t.id)
              .subscribe((clips) => this.clips.set(clips));
          }
        },
        error: (err) => {
          this.publishing.set(false);
          this.uploadMsg.set('Erreur: ' + (err.error?.message ?? err.message));
        },
      });
  }

  /** Pre-remplit le formulaire d un clip et l ouvre. */
  ouvrirFormulaireClip(clip: Clip) {
    this.showPlaylistForm.set(false);
    this.showPublishForm.set(false);
    this.clipEnCours.set(clip);
    this.clipTitre = clip.title ?? clip.roundName ?? `Set ${clip.setOrder}`;
    this.clipDescription = clip.description ?? this.descriptionParDefaut(clip);
    this.clipPrivacy = clip.privacyStatus ?? 'unlisted';
  }

  private descriptionParDefaut(clip: Clip): string {
    return [clip.roundName, clip.players, clip.score ? `Score : ${clip.score}` : '']
      .filter(Boolean)
      .join('\n');
  }

  confirmerEnvoiClip() {
    const clip = this.clipEnCours();
    if (!clip || !this.clipTitre.trim()) return;
    this.clipEnCours.set(null);
    this.uploadOne(clip, {
      title: this.clipTitre,
      description: this.clipDescription,
      privacyStatus: this.clipPrivacy,
    });
  }

  /**
   * Envoie les clips un par un, en attendant la fin de chacun.
   *
   * En parallele, les vingt-deux envois heurtaient ensemble le plafond
   * journalier de la chaine et repartaient tous en echec. En serie, seul le
   * premier refuse s arrete, et les suivants restent envoyables.
   */
  private envoyerEnSerie(restants: Clip[], faits: number) {
    const clip = restants[0];
    if (!clip) {
      this.uploadingAll.set(false);
      this.uploadMsg.set(`${faits} clip(s) envoye(s).`);
      return;
    }

    this.uploadMsg.set(
      `Envoi ${faits + 1} sur ${faits + restants.length} : ${clip.title ?? clip.roundName ?? ''}`,
    );

    this.api
      .uploadClipToYoutube(clip.id, {
        title: clip.title ?? clip.roundName ?? `Set ${clip.setOrder}`,
        description: clip.description ?? this.descriptionParDefaut(clip),
        privacyStatus: this.clipPrivacy,
      })
      .subscribe({
        next: () => {
          this.clips.update((list) =>
            list.map((c) => (c.id === clip.id ? { ...c, status: 'UPLOADING' } : c)),
          );
          this.attendreFin(clip.id, () =>
            this.envoyerEnSerie(restants.slice(1), faits + 1),
          );
        },
        error: (err) => {
          this.uploadingAll.set(false);
          this.uploadMsg.set(
            `Arrete apres ${faits} envoi(s) : ${err.error?.message ?? err.message}`,
          );
        },
      });
  }

  /** Attend qu un clip quitte l etat UPLOADING, puis enchaine. */
  private attendreFin(clipId: string, suite: () => void) {
    const timer = setInterval(() => {
      this.api.getClip(clipId).subscribe((c) => {
        if (c.status === 'UPLOADING') return;
        clearInterval(timer);
        this.clips.update((list) => list.map((x) => (x.id === clipId ? c : x)));
        if (c.status === 'UPLOADED') {
          suite();
        } else {
          // Statut revenu a APPROVED : plafond de la chaine atteint, inutile
          // d insister, les suivants echoueraient pareil.
          this.uploadingAll.set(false);
          this.plafondAtteint.set(true);
          this.uploadMsg.set('');
        }
      });
    }, 4000);
  }

  uploadOne(clip: Clip, meta: { title: string; description: string; privacyStatus: string }) {
    // Optimistic UI
    this.clips.update(list => list.map(c => c.id === clip.id ? { ...c, status: 'UPLOADING' } : c));
    this.api.uploadClipToYoutube(clip.id, meta).subscribe({
      next: (r) => {
        if (r.alreadyUploaded) {
          this.clips.update(list => list.map(c => c.id === clip.id ? { ...c, status: 'UPLOADED', youtubeVideoId: r.youtubeVideoId } : c));
        } else {
          this.uploadMsg.set('Envoi en cours…');
          this.pollClip(clip.id);
        }
      },
      error: (err) => {
        this.clips.update(list => list.map(c => c.id === clip.id ? { ...c, status: 'FAILED' } : c));
        this.uploadMsg.set('Erreur: ' + (err.error?.message ?? err.message));
      },
    });
  }

  downloadAll() {
    this.clips().forEach((clip, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = this.api.getClipDownloadUrl(clip.id);
        a.download = '';
        a.click();
      }, i * 800);
    });
  }

  uploadAll() {
    const uploadable = this.clips().filter(c => c.status !== 'UPLOADED' && c.status !== 'UPLOADING');
    if (uploadable.length === 0) return;
    const tournamentId = this.tournament()?.id;
    if (!tournamentId) return;

    this.uploadingAll.set(true);
    this.showPlaylistForm.set(false);
    this.uploadMsg.set('Création de la playlist...');

    this.api.ensureTournamentPlaylist(tournamentId, {
      privacyStatus: this.playlistPrivacy,
      description: this.playlistDescription,
    }).subscribe({
      next: (res) => {
        this.uploadMsg.set(`${res.created ? 'Playlist créée' : 'Playlist existante'} — Upload de ${uploadable.length} clips en cours...`);
        this.envoyerEnSerie(uploadable, 0);
      },
      error: (err) => {
        this.uploadingAll.set(false);
        this.uploadMsg.set('Erreur playlist: ' + (err.error?.message ?? err.message));
      },
    });
  }

  private pollClip(clipId: string, attempts = 0) {
    if (attempts > 60) return; // Stop after ~5min
    setTimeout(() => {
      this.api.getClip(clipId).subscribe({
        next: (c) => {
          this.clips.update(list => list.map(existing =>
            existing.id === clipId ? { ...existing, status: c.status, youtubeVideoId: (c as any).youtubeVideoId } : existing
          ));
          if (c.status === 'UPLOADING') {
            this.pollClip(clipId, attempts + 1);
          } else if (c.status === 'UPLOADED') {
            this.uploadMsg.set('Clip en ligne.');
          } else if (c.status === 'APPROVED') {
            // Revenu à APPROVED sans identifiant YouTube : plafond de la chaîne.
            this.plafondAtteint.set(true);
            this.uploadMsg.set('');
          }
        },
        error: () => {},
      });
    }, 5000);
  }

  formatDuration(start: number, end: number): string {
    const s = Math.round(end - start);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
}
