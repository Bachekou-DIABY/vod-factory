import { Component, inject, signal, computed, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService, Vod, Clip, ClipPlan, StartGGSetPreview, AlignmentReport } from '../../services/api.service';
import { IconComponent } from '../../components/icon';
import { statutClip, statutVod } from '../../components/vod-status';

/**
 * Minuscules sans accents, pour que « Régis » se trouve en tapant « regis ».
 * Les pseudos de la scène mélangent accents, kana et symboles.
 */
function normaliser(texte: string): string {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

@Component({
  selector: 'app-vod-detail',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <main class="px-6 lg:px-10 py-8 max-w-[1440px] mx-auto flex flex-col gap-6">
      <a [routerLink]="vod()?.tournamentSlug ? ['/tournaments', vod()!.tournamentSlug] : ['/']"
        class="self-start flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-100">
        <app-icon name="arrow-left" [size]="16" /> Tournoi
      </a>

      @if (loading()) {
        <p class="text-gray-400 text-sm">Chargement…</p>
      } @else if (vod(); as v) {

        <!-- En-tête -->
        <div class="flex flex-wrap items-end gap-6">
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <span class="eyebrow">VOD{{ v.streamName ? ' · ' + v.streamName : '' }}</span>
            @if (editingName()) {
              <label for="nom-vod" class="sr-only">Nom de la VOD</label>
              <input id="nom-vod" #nameInput [(ngModel)]="editNameValue"
                (blur)="saveName()" (keydown.enter)="saveName()" (keydown.escape)="editingName.set(false)"
                class="text-4xl font-bold bg-transparent border-b-2 border-accent outline-none w-full" autofocus />
            } @else {
              <button type="button" (click)="startEditName(v)" class="self-start text-left text-4xl font-bold leading-tight hover:text-gray-300 truncate max-w-full" title="Renommer">
                {{ v.name || v.sourceUrl }}
              </button>
            }
            <div class="flex flex-wrap gap-2 text-xs text-gray-400">
              <span class="px-2.5 py-1 rounded-md font-medium" [class]="statut(v.status).classes">{{ vodLabel(v.status) }}</span>
              @if (v.streamName) { <span class="px-2.5 py-1 border border-gray-700 rounded-md">Chaîne {{ v.streamName }}</span> }
              @if (dureeVod() > 0) { <span class="px-2.5 py-1 border border-gray-700 rounded-md font-mono">{{ toHMS(dureeVod()) }}</span> }
              @if (v.fileSize && v.filePath) { <span class="px-2.5 py-1 border border-gray-700 rounded-md font-mono">{{ fmtGo(v.fileSize) }}</span> }
              @if (!v.filePath && v.status !== 'DOWNLOADING') { <span class="px-2.5 py-1 border border-gray-700 rounded-md">Fichier source supprimé</span> }
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button (click)="openImportSets()" class="btn btn-secondary">
              <app-icon name="pin" [size]="16" /> {{ v.recordedAt ? 'Recalibrer' : 'Calibrer' }}
            </button>
            @if (v.filePath) {
              <button (click)="remux()" [disabled]="remuxing() || v.status === 'PROCESSING'" class="btn btn-secondary"
                title="Réécrit le fichier pour qu'il se lise directement dans le navigateur">
                <app-icon name="wand" [size]="16" /> {{ remuxing() || v.status === 'PROCESSING' ? 'Correction…' : 'Corriger le format' }}
              </button>
              <button (click)="deleteSourceFile()" [disabled]="deletingSourceFile()" class="btn btn-secondary"
                title="Libère l'espace disque. Les clips sont conservés, mais plus aucune réanalyse ni recoupe ne sera possible.">
                {{ deletingSourceFile() ? 'Suppression…' : 'Supprimer la source' }}
              </button>
            }
            @if (v.status === 'FAILED') {
              <button (click)="retryDownload()" [disabled]="retryingDownload()" class="btn btn-secondary">
                <app-icon name="refresh" [size]="16" /> {{ retryingDownload() ? '…' : 'Relancer le téléchargement' }}
              </button>
            }
            <button (click)="deleteVod()" class="btn btn-danger" aria-label="Supprimer la VOD">
              <app-icon name="trash" [size]="16" />
            </button>
          </div>
        </div>

        <!-- Étapes -->
        <ol aria-label="Étapes de traitement" class="grid grid-cols-2 md:grid-cols-5 gap-3">
          @for (e of etapes(); track e.titre) {
            <li class="px-4 py-3.5 rounded-xl border flex items-center gap-3"
              [class]="e.etat === 'encours' ? 'bg-gray-800 border-accent' : 'bg-gray-900 border-gray-800'"
              [attr.aria-current]="e.etat === 'encours' ? 'step' : null">
              @if (e.etat === 'fait') {
                <span class="w-7 h-7 shrink-0 rounded-full bg-accent text-accent-ink flex items-center justify-center">
                  <app-icon name="check" [size]="15" />
                </span>
              } @else {
                <span class="w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center font-mono text-xs"
                  [class]="e.etat === 'encours' ? 'border-accent text-accent' : 'border-gray-700 text-gray-400'">{{ e.numero }}</span>
              }
              <span class="flex flex-col min-w-0">
                <span class="text-sm font-semibold">{{ e.titre }}</span>
                <span class="text-xs truncate" [class]="e.etat === 'encours' ? 'text-accent' : 'text-gray-400'">{{ e.detail }}</span>
              </span>
            </li>
          }
        </ol>

        <!-- Téléchargement -->
        @if (v.status === 'DOWNLOADING') {
          <div class="card p-4 flex items-center gap-4">
            <span class="text-sm">Téléchargement</span>
            <div class="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div class="h-full bg-accent transition-all duration-500" [style.width]="(downloadProgress() ?? 0) + '%'"></div>
            </div>
            <span class="text-sm font-mono text-accent w-14 text-right">{{ downloadProgress() ?? 0 }} %</span>
            <button (click)="retryDownload()" [disabled]="retryingDownload()" class="btn btn-secondary btn-sm" title="Relancer si bloqué à 0 %">
              <app-icon name="refresh" [size]="14" /> {{ retryingDownload() ? '…' : 'Relancer' }}
            </button>
          </div>
        }

        <!-- Génération des clips -->
        @if (generationLancee()) {
          <div class="card border-accent-deep p-5 flex flex-col gap-3" role="status">
            <div class="flex items-center gap-3">
              <span class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0"></span>
              <span class="text-sm font-medium flex-1">Génération des clips…</span>
              <span class="text-sm font-mono text-accent">{{ clipsGeneres() }} / {{ clipsAttendus() }}</span>
            </div>
            <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div class="h-full bg-accent transition-all duration-500" [style.width]="progressionClips() + '%'"></div>
            </div>
            <p class="text-xs text-gray-400">Les clips apparaissent au fur et à mesure en bas de page. Inutile de rafraîchir.</p>
          </div>
        }

        <!-- Conversion -->
        @if (!generationLancee() && v.status === 'PROCESSING' && clips().length === 0) {
          <div class="card p-5 flex items-start gap-3" role="status">
            <span class="w-4 h-4 mt-0.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0"></span>
            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium">Conversion en cours</span>
              <span class="text-xs text-gray-400 leading-relaxed">Le fichier est réécrit pour être lisible dans le navigateur. Quelques minutes selon sa taille ; la page se met à jour seule.</span>
            </div>
          </div>
        }

        @if (analyseMsg()) {
          <p class="text-sm" [class]="analyseErreur() ? 'text-alert-text' : 'text-gray-400'" role="status">{{ analyseMsg() }}</p>
        }

        <!-- Lecteur et analyse -->
        <div class="flex flex-col xl:flex-row gap-6 items-stretch">
          <div class="flex-1 min-w-0 flex flex-col gap-4">
            @if (v.filePath && !(!generationLancee() && v.status === 'PROCESSING' && clips().length === 0)) {
              <video #vodVideoEl class="w-full aspect-video rounded-xl bg-black border border-gray-800" controls preload="metadata"
                [src]="api.getStreamUrl(v.id)" (loadedmetadata)="onVodMetadata()" (timeupdate)="onVodTimeUpdate()"></video>
            } @else if (!v.filePath && v.status !== 'DOWNLOADING') {
              <div class="w-full aspect-video rounded-xl bg-gray-900 border border-dashed border-gray-700 flex flex-col items-center justify-center gap-2 text-center px-6">
                <span class="text-sm">Fichier source supprimé</span>
                <span class="text-xs text-gray-400">Les clips sont conservés. Réanalyser ou recouper demanderait de réimporter la VOD.</span>
              </div>
            }

            <!-- Recoupe d'un clip -->
            @if (expandedClip(); as clip) {
              <section class="card border-accent-deep p-5 flex flex-col gap-4" aria-labelledby="titre-recoupe">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <h3 id="titre-recoupe" class="text-sm font-semibold text-accent">Recouper le clip</h3>
                    <p class="text-xs text-gray-400 truncate mt-0.5">{{ clip.title ?? clip.roundName ?? ('Set ' + clip.setOrder) }}</p>
                  </div>
                  <span class="text-xs font-mono shrink-0">
                    {{ toHMS(recutStart()) }} → {{ toHMS(recutEnd()) }} <span class="text-gray-400">({{ toHMS(recutEnd() - recutStart()) }})</span>
                  </span>
                </div>

                @if (vodDuration() > 0) {
                  <div class="relative h-10 flex items-center cursor-pointer select-none" (pointerdown)="onClipRecutPointerDown($event)">
                    <div class="absolute inset-x-2 h-2 bg-gray-700 rounded-full"></div>
                    <div class="absolute h-2 bg-accent rounded-full pointer-events-none" [style.left]="thumbPos(recutStartPct())" [style.right]="thumbPos(100 - recutEndPct())"></div>
                    <div class="absolute w-px h-4 bg-white/50 pointer-events-none" [style.left]="thumbPos(vodCurrentPct())"></div>
                    <div class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-accent -translate-x-1/2 z-10 pointer-events-none" [style.left]="thumbPos(recutStartPct())"></div>
                    <div class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-accent -translate-x-1/2 z-10 pointer-events-none" [style.left]="thumbPos(recutEndPct())"></div>
                  </div>
                }

                <div class="flex flex-wrap items-end gap-3">
                  <div>
                    <label for="recoupe-debut" class="label">Début</label>
                    <input id="recoupe-debut" type="text" [value]="toHMS(recutStart())" (change)="onClipRecutStartInput($event)" class="field w-32 font-mono" placeholder="hh:mm:ss" />
                  </div>
                  <div>
                    <label for="recoupe-fin" class="label">Fin</label>
                    <input id="recoupe-fin" type="text" [value]="toHMS(recutEnd())" (change)="onClipRecutEndInput($event)" class="field w-32 font-mono" placeholder="hh:mm:ss" />
                  </div>
                  <button (click)="seekMainVideo(recutStart())" class="btn btn-secondary btn-sm">Aller au début</button>
                  <button (click)="seekMainVideo(recutEnd() - 5)" class="btn btn-secondary btn-sm">Aller à la fin</button>
                  <button (click)="setClipRecutFromCurrent('start')" class="btn btn-secondary btn-sm">Début ici</button>
                  <button (click)="setClipRecutFromCurrent('end')" class="btn btn-secondary btn-sm">Fin ici</button>
                </div>

                <div class="flex items-center gap-3">
                  <button (click)="applyClipRecut(clip.id)" [disabled]="recutting()" class="btn btn-primary">
                    <app-icon name="scissors" [size]="16" /> {{ recutting() ? 'Recoupe…' : 'Recouper' }}
                  </button>
                  <button (click)="expandedClipId.set(null)" class="btn btn-secondary">Fermer</button>
                  @if (recutMsg()) { <span class="text-xs text-accent">{{ recutMsg() }}</span> }
                </div>
              </section>
            }
          </div>

          <!-- Panneau d'analyse -->
          <section class="card p-6 w-full xl:w-[440px] shrink-0 flex flex-col gap-5" aria-labelledby="titre-analyse">
            <h2 id="titre-analyse" class="text-xl font-semibold">Analyse du signal</h2>

            @if (!v.recordedAt) {
              <p class="text-sm text-gray-400 leading-relaxed">
                L'analyse doit connaître l'heure réelle du début de la vidéo. Calibre-la sur un set que tu reconnais.
              </p>
              <button (click)="openImportSets()" class="btn btn-primary self-start">
                <app-icon name="pin" [size]="16" /> Calibrer le début du stream
              </button>
            } @else if (resumeAnalyse(); as r) {
              <div class="grid grid-cols-2 gap-3">
                <div class="bg-gray-800 rounded-lg px-4 py-3 flex flex-col gap-1">
                  <span class="font-mono text-2xl" [class]="r.exacts === r.total ? 'text-accent' : ''">{{ r.exacts }} / {{ r.total }}</span>
                  <span class="text-xs text-gray-400">sets au compte exact</span>
                </div>
                <div class="bg-gray-800 rounded-lg px-4 py-3 flex flex-col gap-1">
                  <span class="font-mono text-2xl">{{ r.attribuees }}</span>
                  <span class="text-xs text-gray-400">games attribuées sur {{ r.detectees }}</span>
                </div>
                <div class="bg-gray-800 rounded-lg px-4 py-3 flex flex-col gap-1">
                  <span class="font-mono text-2xl">{{ r.orphelins }}</span>
                  <span class="text-xs text-gray-400">orphelins, hors découpe</span>
                </div>
                <div class="bg-gray-800 rounded-lg px-4 py-3 flex flex-col gap-1">
                  <span class="font-mono text-2xl">{{ r.ecart }}</span>
                  <span class="text-xs text-gray-400">écart Start.gg, fiabilité {{ r.fiabilite }}</span>
                </div>
              </div>

              @if (r.partiels > 0 || r.nonDetectes > 0) {
                <div class="banner-alert text-sm">
                  <app-icon name="alert" class="text-alert-text mt-0.5" />
                  <span>
                    @if (r.partiels > 0) { {{ r.partiels }} set(s) incomplet(s). }
                    @if (r.nonDetectes > 0) { {{ r.nonDetectes }} set(s) introuvable(s) dans la vidéo. }
                    Ils sont signalés dans le tableau.
                  </span>
                </div>
              }

              <div class="flex flex-wrap items-end gap-3 mt-auto pt-2">
                <div>
                  <label for="seuil" class="label">Seuil de confiance</label>
                  <input id="seuil" type="number" [(ngModel)]="minConfiance" min="0" max="1" step="0.05" class="field w-24 font-mono" />
                </div>
                <button (click)="genererDepuisAnalyse()" [disabled]="generationEnCours() || setsRetenus() === 0" class="btn btn-primary flex-1">
                  <app-icon name="scissors" [size]="16" />
                  {{ generationEnCours() ? 'Génération…' : (clips().length ? 'Régénérer' : 'Générer') + ' ' + setsRetenus() + ' clip(s)' }}
                </button>
                <button (click)="lancerAnalyse()" [disabled]="analyseEnCours()" class="btn btn-secondary">
                  {{ analyseEnCours() ? 'Analyse…' : "Relancer l'analyse" }}
                </button>
              </div>
            } @else {
              <p class="text-sm text-gray-400 leading-relaxed">
                Détecte les games dans la vidéo et les répartit entre les sets Start.gg, d'après leur score. Environ une minute par heure de vidéo.
              </p>
              <button (click)="lancerAnalyse()" [disabled]="analyseEnCours() || !v.filePath" class="btn btn-primary self-start">
                <app-icon name="target" [size]="16" /> {{ analyseEnCours() ? 'Analyse en cours…' : 'Analyser la vidéo' }}
              </button>
            }
          </section>
        </div>

        <!-- Chronologie -->
        @if (frise(); as f) {
          <section class="card px-6 pt-5 pb-4 flex flex-col gap-3" aria-labelledby="titre-frise">
            <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
              <h2 id="titre-frise" class="text-lg font-semibold flex-1">Chronologie de la VOD</h2>
              <span class="flex items-center gap-2 text-xs text-gray-400"><span class="w-3 h-3 rounded-sm bg-accent"></span>Set découpé</span>
              <span class="flex items-center gap-2 text-xs text-gray-400"><span class="w-3 h-3 rounded-sm bg-alert"></span>Set incomplet</span>
              <span class="flex items-center gap-2 text-xs text-gray-400"><span class="w-0.5 h-3 bg-gray-400"></span>Orphelin</span>
            </div>
            <div class="relative h-14 bg-gray-800 rounded-lg">
              @for (s of f.segments; track s.cle) {
                <button type="button" (click)="seekMainVideo(s.debut)" [attr.aria-label]="s.titre + ', aller à ' + toHMS(s.debut)" [title]="s.titre"
                  class="absolute top-2.5 h-9 rounded-sm hover:brightness-125 transition"
                  [class]="s.partiel ? 'bg-alert' : 'bg-accent'"
                  [style.left.%]="s.l" [style.width.%]="s.w"></button>
              }
              @for (o of f.orphelins; track o.cle) {
                <span class="absolute top-1.5 h-11 w-0.5 bg-gray-400 pointer-events-none" [style.left.%]="o.l"></span>
              }
              @if (vodDuration() > 0) {
                <span class="absolute -top-1 -bottom-1 w-0.5 bg-white pointer-events-none" [style.left.%]="vodCurrentPct()"></span>
              }
            </div>
            <div class="relative h-4">
              @for (h of f.heures; track h.label) {
                <span class="absolute font-mono text-[11px] text-gray-400" [style.left.%]="h.l">{{ h.label }}</span>
              }
            </div>
          </section>
        }

        <!-- Sets découpés -->
        @if (rapport(); as r) {
          <section class="card overflow-hidden" aria-labelledby="titre-sets">
            <div class="px-6 py-4 flex items-center gap-4 border-b border-gray-800">
              <h2 id="titre-sets" class="text-lg font-semibold flex-1">Sets</h2>
              <span class="text-xs text-gray-400">{{ setsRetenus() }} passent le seuil de {{ minConfiance }}</span>
            </div>
            <div class="overflow-x-auto">
              <div class="min-w-[880px]">
                <div class="grid grid-cols-[48px_240px_minmax(0,1fr)_80px_96px_96px_130px] gap-x-3 px-6 py-2.5 text-[11px] tracking-wider uppercase text-gray-400 border-b border-gray-800">
                  <span>#</span><span>Round</span><span>Joueurs</span><span>Games</span><span>Début</span><span>Fin</span><span>Confiance</span>
                </div>
                @for (a of r.aligned; track a.set.setStartGGId; let i = $index) {
                  <div class="grid grid-cols-[48px_240px_minmax(0,1fr)_80px_96px_96px_130px] gap-x-3 items-center px-6 py-3 text-sm border-b border-gray-800/70 last:border-0">
                    <span class="font-mono text-gray-400">{{ i + 1 }}</span>
                    <span class="flex flex-col min-w-0">
                      <span class="truncate">{{ a.set.roundName }}</span>
                      @if (a.set.phaseName) { <span class="text-[11px] text-gray-400 truncate">{{ a.set.phaseName }}</span> }
                    </span>
                    <span class="flex flex-col min-w-0">
                      <span class="truncate">{{ a.set.players }}</span>
                      @for (w of a.warnings; track w) {
                        <span class="text-xs text-alert-text">{{ w }}</span>
                      }
                    </span>
                    <span class="font-mono" [class]="a.source === 'video' ? 'text-accent' : a.source === 'video-partial' ? 'text-alert-text' : 'text-gray-400'">
                      {{ a.games.length }}{{ a.set.gameCount !== null ? '/' + a.set.gameCount : '' }}
                    </span>
                    @if (a.source === 'api') {
                      <span class="col-span-2 text-xs text-gray-400">Introuvable dans la vidéo</span>
                    } @else {
                      <button type="button" (click)="seekMainVideo(a.startSeconds)" class="text-left font-mono hover:text-accent" [attr.aria-label]="'Aller au début de ' + a.set.roundName">{{ toHMS(a.startSeconds) }}</button>
                      <span class="font-mono">{{ toHMS(a.endSeconds) }}</span>
                    }
                    <span class="flex items-center gap-2.5">
                      <span class="w-14 h-1 bg-gray-700 rounded-full overflow-hidden">
                        <span class="block h-full rounded-full" [class]="a.confidence >= minConfiance ? 'bg-gray-100' : 'bg-alert'" [style.width.%]="a.confidence * 100"></span>
                      </span>
                      <span class="font-mono text-xs" [class]="a.confidence >= minConfiance ? '' : 'text-alert-text'">{{ fmtConf(a.confidence) }}</span>
                    </span>
                  </div>
                }
              </div>
            </div>
          </section>
        }

        <!-- Calibrage -->
        @if (showImportSets()) {
          <section class="card p-6 flex flex-col gap-4" aria-labelledby="titre-calibrage">
            <div class="flex items-start justify-between gap-4">
              <div class="flex flex-col gap-1">
                <h2 id="titre-calibrage" class="text-xl font-semibold">Calibrer le début du stream</h2>
                <p class="text-sm text-gray-400 leading-relaxed">
                  Place le lecteur sur le début d'un set que tu reconnais, choisis ce set, puis enregistre. L'analyse en déduit l'heure réelle du début de la vidéo.
                </p>
              </div>
              <button (click)="showImportSets.set(false)" class="btn btn-secondary btn-sm" aria-label="Fermer le calibrage">
                <app-icon name="x" [size]="16" />
              </button>
            </div>

            @if (!importRecordedAt) {
              @if (vod()?.eventStartGGId) {
                <div class="bg-gray-800 border border-gray-700 rounded-lg p-4 flex flex-col gap-3">
                  @if (loadingCalibrationSets()) {
                    <p class="text-sm text-gray-400">Chargement des sets…</p>
                  } @else if (calibrationSets().length) {
                    @if (calibrationStreams().length > 1) {
                      <div>
                        <label for="calib-chaine" class="label">Chaîne</label>
                        <select id="calib-chaine" [ngModel]="selectedCalibrationStream()"
                          (ngModelChange)="selectedCalibrationStream.set($event); selectedCalibrationSetId = ''; calibrationSearch.set('')"
                          class="field w-full">
                          @for (c of calibrationStreams(); track c.nom) {
                            <option [value]="c.nom">{{ c.nom }} · {{ c.nombre }} sets</option>
                          }
                        </select>
                      </div>
                    }
                    <div>
                      <label for="calib-filtre" class="label">Filtrer</label>
                      <input id="calib-filtre" type="text" [ngModel]="calibrationSearch()" (ngModelChange)="calibrationSearch.set($event)"
                        placeholder="Joueur, round ou phase" class="field w-full" />
                    </div>
                    <div>
                      <label for="calib-set" class="label">Set visible dans le lecteur</label>
                      <select id="calib-set" [(ngModel)]="selectedCalibrationSetId" class="field w-full">
                        <option value="">Choisir un set ({{ calibrationSetsAffiches() }})</option>
                        @for (phase of calibrationSetsParPhase(); track phase.nom) {
                          <optgroup [label]="phase.nom">
                            @for (s of phase.sets; track s.id) {
                              <option [value]="s.id">{{ s.heure }} · {{ s.roundName }} — {{ s.player1?.name }} vs {{ s.player2?.name }}</option>
                            }
                          </optgroup>
                        }
                      </select>
                    </div>
                    @if (calibrationSearch() && calibrationSetsAffiches() === 0) {
                      <p class="text-xs text-alert-text">Aucun set ne correspond sur cette chaîne.</p>
                    }
                    <button (click)="calibrateFromSet()" [disabled]="!selectedCalibrationSetId" class="btn btn-primary self-start">
                      <app-icon name="pin" [size]="16" /> Enregistrer à {{ toHMS(vodCurrentTime()) }}
                    </button>
                  } @else {
                    <p class="text-sm text-gray-400">Aucun set horodaté disponible sur Start.gg.</p>
                  }
                </div>
              }

              <div>
                <button (click)="showAdvancedTimestamp.set(!showAdvancedTimestamp())" class="text-sm text-gray-400 hover:text-gray-100" [attr.aria-expanded]="showAdvancedTimestamp()">
                  {{ showAdvancedTimestamp() ? 'Masquer' : 'Afficher' }} les options avancées
                </button>
                @if (showAdvancedTimestamp()) {
                  <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label for="calib-url" class="label">Lien du stream d'origine</label>
                      <div class="flex gap-2">
                        <input id="calib-url" type="text" [(ngModel)]="timestampUrl" placeholder="https://www.twitch.tv/videos/…" class="field flex-1 min-w-0" />
                        <button (click)="fetchTimestamp()" [disabled]="fetchingTimestamp() || (isLocalVod() && !timestampUrl.trim())" class="btn btn-secondary">
                          {{ fetchingTimestamp() ? '…' : 'Récupérer' }}
                        </button>
                      </div>
                      @if (!isLocalVod()) { <p class="text-xs text-gray-400 mt-1.5">Vide : le lien d'origine de la VOD est utilisé.</p> }
                    </div>
                    <div>
                      <label for="calib-unix" class="label">Horodatage Unix</label>
                      <div class="flex gap-2">
                        <input id="calib-unix" type="number" [(ngModel)]="importRecordedAt" placeholder="ex. 1742654400" class="field flex-1 min-w-0 font-mono" />
                        @if (vod()?.eventStartGGId) {
                          <button (click)="estimateFromSets()" [disabled]="estimatingTimestamp()" class="btn btn-secondary" title="Estimation depuis le premier set Start.gg, à 15 minutes près">
                            {{ estimatingTimestamp() ? '…' : 'Estimer' }}
                          </button>
                        }
                      </div>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <div class="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                <app-icon name="check" class="text-accent" />
                <span class="text-sm flex-1">Calibré : début le {{ unixToLocale(importRecordedAt) }}</span>
                <button (click)="resetTimestamp()" class="btn btn-secondary btn-sm">Recalibrer</button>
              </div>
              <p class="text-xs text-gray-400 leading-relaxed">
                Sans calibrage manuel, cette heure vient des métadonnées de la vidéo. Elle est fausse sur une republication : si les clips sont décalés, recalibre.
              </p>
            }
            @if (calibrationMsg()) {
              <p class="text-sm text-accent" role="status">{{ calibrationMsg() }}</p>
            }
          </section>
        }

        <!-- Clip manuel -->
        @if (v.filePath && vodDuration() > 0) {
          <details class="card group">
            <summary class="px-6 py-4 flex items-center gap-3 cursor-pointer list-none">
              <app-icon name="plus" class="text-gray-400" />
              <span class="text-sm font-semibold flex-1">Créer un clip à la main</span>
              <span class="text-xs font-mono text-gray-400">{{ formatTime(manualStart()) }} → {{ formatTime(manualEnd()) }}</span>
            </summary>
            <div class="px-6 pb-6 flex flex-col gap-4">
              <div class="relative h-10 flex items-center cursor-pointer select-none" #manualSlider (pointerdown)="onManualPointerDown($event, manualSlider)">
                <div class="absolute inset-x-2 h-2 bg-gray-700 rounded-full"></div>
                <div class="absolute h-2 bg-accent rounded-full pointer-events-none" [style.left]="thumbPos(manualStartPct())" [style.right]="thumbPos(100 - manualEndPct())"></div>
                <div class="absolute w-px h-4 bg-white/50 pointer-events-none" [style.left]="thumbPos(vodCurrentPct())"></div>
                <div class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-accent -translate-x-1/2 z-10 pointer-events-none" [style.left]="thumbPos(manualStartPct())"></div>
                <div class="absolute w-5 h-5 bg-white rounded-full shadow-lg border-2 border-accent -translate-x-1/2 z-10 pointer-events-none" [style.left]="thumbPos(manualEndPct())"></div>
              </div>
              <div class="flex flex-wrap items-end gap-3">
                <div>
                  <label for="manuel-debut" class="label">Début</label>
                  <input id="manuel-debut" type="text" [value]="toHMS(manualStart())" (change)="onManualStartInput($event)" class="field w-32 font-mono" placeholder="hh:mm:ss" />
                </div>
                <div>
                  <label for="manuel-fin" class="label">Fin</label>
                  <input id="manuel-fin" type="text" [value]="toHMS(manualEnd())" (change)="onManualEndInput($event)" class="field w-32 font-mono" placeholder="hh:mm:ss" />
                </div>
                <button (click)="setManualStartFromCurrent()" class="btn btn-secondary btn-sm">Début ici</button>
                <button (click)="setManualEndFromCurrent()" class="btn btn-secondary btn-sm">Fin ici</button>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <label for="manuel-titre" class="sr-only">Titre du clip</label>
                <input id="manuel-titre" [(ngModel)]="manualTitle" placeholder="Titre du clip (facultatif)" class="field flex-1 min-w-48" />
                <button (click)="createManualClip()" [disabled]="creatingManualClip()" class="btn btn-primary">
                  {{ creatingManualClip() ? 'Création…' : 'Créer le clip' }}
                </button>
              </div>
              @if (manualClipMsg()) { <p class="text-accent text-xs" role="status">{{ manualClipMsg() }}</p> }
            </div>
          </details>
        }

        <!-- Clips -->
        @if (clips().length) {
          <section id="clips-section" class="flex flex-col gap-4" aria-labelledby="titre-clips">
            <div class="flex flex-wrap items-center gap-3">
              <h2 id="titre-clips" class="text-2xl font-semibold flex-1">
                Clips <span class="font-mono text-gray-400 text-lg">{{ filteredClips().length }}{{ clipStatusFilter() !== 'ALL' ? '/' + clips().length : '' }}</span>
              </h2>
              <div role="group" aria-label="Filtrer les clips" class="flex flex-wrap bg-gray-900 border border-gray-800 rounded-lg p-1">
                @for (f of clipFilters; track f.value) {
                  <button (click)="clipStatusFilter.set(f.value)" [attr.aria-pressed]="clipStatusFilter() === f.value"
                    class="h-9 px-3 rounded-md text-sm transition-colors"
                    [class]="clipStatusFilter() === f.value ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:text-gray-100'">
                    {{ f.label }} <span class="font-mono text-gray-400 ml-0.5">{{ clipCount(f.value) }}</span>
                  </button>
                }
              </div>
              <label class="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
                <input type="checkbox" [checked]="selectedClipIds().size === filteredClips().length && filteredClips().length > 0"
                  (change)="toggleSelectAll()" class="w-4 h-4 rounded accent-accent" />
                Tout sélectionner
              </label>
            </div>

            <!-- Description commune -->
            <details class="card">
              <summary class="px-5 py-3.5 text-sm cursor-pointer list-none flex items-center gap-3">
                <span class="flex-1">Description commune à tous les clips</span>
                <span class="text-xs text-gray-400">Remplace la description de chaque clip</span>
              </summary>
              <div class="px-5 pb-5 flex flex-col gap-3">
                <label for="desc-commune" class="sr-only">Description commune</label>
                <textarea id="desc-commune" [(ngModel)]="sharedDescription" rows="3"
                  placeholder="Description YouTube appliquée à tous les clips de cette VOD"
                  class="field h-auto py-2.5 w-full resize-none"></textarea>
                <div class="flex items-center gap-3">
                  <button (click)="applySharedDescription()" [disabled]="!sharedDescription.trim() || applyingDescription()" class="btn btn-primary btn-sm">
                    {{ applyingDescription() ? 'Application…' : 'Appliquer à tous les clips' }}
                  </button>
                  @if (sharedDescriptionMsg()) { <span class="text-accent text-xs" role="status">{{ sharedDescriptionMsg() }}</span> }
                </div>
              </div>
            </details>

            @if (selectedClipIds().size > 0) {
              <div class="card px-4 py-3 flex flex-wrap items-center gap-3" role="toolbar" aria-label="Actions sur la sélection">
                <span class="text-sm text-gray-400 flex-1">{{ selectedClipIds().size }} sélectionné(s)</span>
                <button (click)="bulkApprove()" [disabled]="bulkActing()" class="btn btn-primary btn-sm">
                  <app-icon name="check" [size]="15" /> Approuver
                </button>
                <button (click)="bulkDisapprove()" [disabled]="bulkActing()" class="btn btn-secondary btn-sm">Retirer l'approbation</button>
                <button (click)="bulkDelete()" [disabled]="bulkActing()" class="btn btn-danger btn-sm">
                  <app-icon name="trash" [size]="15" /> Supprimer
                </button>
                <button (click)="clearSelection()" class="btn btn-secondary btn-sm">Annuler</button>
              </div>
            }

            <ul class="flex flex-col gap-3">
              @for (clip of filteredClips(); track clip.id) {
                <li [id]="'clip-row-' + clip.id" class="rounded-xl border bg-gray-900 transition-colors"
                  [class]="isSelected(clip.id) ? 'border-accent' : (expandedClipId() === clip.id ? 'border-accent-deep' : 'border-gray-800')">
                  <div class="flex items-center gap-4 p-4">
                    <input type="checkbox" [checked]="isSelected(clip.id)" (change)="toggleClipSelection(clip.id)"
                      class="w-4 h-4 rounded accent-accent cursor-pointer shrink-0" [attr.aria-label]="'Sélectionner ' + (clip.roundName ?? 'le clip ' + clip.setOrder)" />
                    <a [routerLink]="['/clips', clip.id]" class="flex items-center gap-4 flex-1 min-w-0 group">
                      <span class="shrink-0 w-36 aspect-video rounded-lg overflow-hidden bg-gray-800">
                        <img [src]="api.getClipThumbnailUrl(clip.id)" alt="" class="w-full h-full object-cover" loading="lazy"
                          (error)="$any($event.target).style.display='none'" />
                      </span>
                      <span class="flex-1 min-w-0 flex flex-col gap-1">
                        <span class="text-xs text-gray-400">Set {{ clip.setOrder }} · {{ formatDuration(clip.startSeconds, clip.endSeconds) }} · <span class="font-mono">{{ toHMS(clip.startSeconds) }} → {{ toHMS(clip.endSeconds) }}</span></span>
                        <span class="font-medium truncate group-hover:text-accent">{{ clip.roundName ?? 'Set ' + clip.setOrder }}</span>
                        @if (clip.players) { <span class="text-sm text-gray-300 truncate">{{ clip.players }}</span> }
                      </span>
                    </a>
                    <span class="shrink-0 text-xs font-medium" [class]="statutClipAffiche(clip.status).classes">{{ statutClipAffiche(clip.status).label }}</span>
                    <div class="shrink-0 flex items-center gap-2">
                      @if (clip.status === 'FAILED') {
                        <button (click)="retryClip(clip.id)" [disabled]="retryingClipId() === clip.id" class="btn btn-danger btn-sm" aria-label="Relancer la génération de ce clip">
                          <app-icon name="refresh" [size]="15" />
                        </button>
                      }
                      @if (v.filePath) {
                        <button (click)="toggleClipRecut(clip)" class="btn btn-sm" [attr.aria-pressed]="expandedClipId() === clip.id"
                          [class]="expandedClipId() === clip.id ? 'bg-accent text-accent-ink' : 'btn-secondary'" aria-label="Recouper ce clip">
                          <app-icon name="scissors" [size]="15" />
                        </button>
                      }
                      @if (clip.filePath) {
                        <a [href]="api.getClipDownloadUrl(clip.id)" target="_blank" class="btn btn-secondary btn-sm" aria-label="Télécharger le MP4">
                          <app-icon name="download" [size]="15" />
                        </a>
                      }
                      <button (click)="deleteClip($event, clip.id)" [disabled]="deletingClipId() === clip.id" class="btn btn-danger btn-sm" aria-label="Supprimer ce clip">
                        <app-icon name="trash" [size]="15" />
                      </button>
                    </div>
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      }
    </main>
  `,
})
export class VodDetailPage implements OnInit, OnDestroy {
  @ViewChild('vodVideoEl') vodVideoEl!: ElementRef<HTMLVideoElement>;

  protected readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  vod = signal<Vod | null>(null);
  clips = signal<Clip[]>([]);
  clipPlan = signal<ClipPlan | null>(null);
  loading = signal(true);
  remuxing = signal(false);
  deletingSourceFile = signal(false);
  editingName = signal(false);
  editNameValue = '';
  downloadProgress = signal<number | null>(null);
  retryingClipId = signal<string | null>(null);
  retryingDownload = signal(false);
  deletingClipId = signal<string | null>(null);
  fetchingTimestamp = signal(false);
  estimatingTimestamp = signal(false);
  timestampUrl = '';
  selectedClipIds = signal<Set<string>>(new Set());
  bulkActing = signal(false);

  // Inline clip recut
  expandedClipId = signal<string | null>(null);
  expandedClip = computed(() => this.clips().find(c => c.id === this.expandedClipId()) ?? null);
  recutStart = signal(0);
  recutEnd = signal(0);
  recutting = signal(false);
  recutMsg = signal('');
  private clipRecutDragging: 'start' | 'end' | null = null;

  showAdvancedTimestamp = signal(false);

  // Suivi de la génération des clips. `clipsAuDebut` sert de référence : lors
  // d'un redécoupage, des clips existent déjà et la progression doit compter
  // ceux de ce lot, pas le total en base.
  clipsAttendus = signal(0);
  clipsAuDebut = signal(0);

  generationLancee = computed(() => this.clipsAttendus() > 0);
  clipsGeneres = computed(() =>
    Math.min(
      this.clipsAttendus(),
      Math.max(0, this.clips().length - this.clipsAuDebut()),
    ),
  );
  progressionClips = computed(() => {
    const cible = this.clipsAttendus();
    return cible > 0 ? Math.round((this.clipsGeneres() / cible) * 100) : 0;
  });

  showImportSets = signal(false);
  importRecordedAt = 0;
  calibrationSets = signal<StartGGSetPreview[]>([]);
  loadingCalibrationSets = signal(false);
  selectedCalibrationSetId = '';
  /** Signal, et non propriété simple : `calibrationSetsParPhase` en dépend. */
  selectedCalibrationStream = signal('');
  calibrationSearch = signal('');

  // --- Alignement ---
  rapport = signal<AlignmentReport | null>(null);
  analyseEnCours = signal(false);
  analyseMsg = signal('');
  analyseErreur = signal(false);
  generationEnCours = signal(false);
  minConfiance = 0.45;
  private sondageAnalyse: ReturnType<typeof setInterval> | null = null;
  calibrationMsg = signal('');

  // Manual clip
  vodDuration = signal(0);
  vodCurrentTime = signal(0);
  manualStart = signal(0);
  manualEnd = signal(0);
  manualTitle = '';
  creatingManualClip = signal(false);
  manualClipMsg = signal('');
  sharedDescription = '';
  applyingDescription = signal(false);
  sharedDescriptionMsg = signal('');

  clipStatusFilter = signal<string>('ALL');
  filteredClips = computed(() => {
    const f = this.clipStatusFilter();
    return f === 'ALL' ? this.clips() : this.clips().filter(c => c.status === f);
  });
  readonly clipFilters = [
    { value: 'ALL', label: 'Tous' },
    { value: 'PENDING', label: 'À relire' },
    { value: 'APPROVED', label: 'Approuvés' },
    { value: 'UPLOADED', label: 'En ligne' },
    { value: 'FAILED', label: 'Échecs' },
  ];

  readonly statut = statutVod;
  readonly statutClipAffiche = statutClip;

  /** Durée de référence : celle enregistrée pour le fichier, sinon celle lue par le lecteur. */
  readonly dureeVod = computed(() => this.vod()?.duration || this.vodDuration());

  /**
   * Les cinq étapes du traitement. La première non terminée est l'étape en
   * cours : c'est elle qui dit à l'utilisateur quoi faire ensuite.
   */
  readonly etapes = computed(() => {
    const v = this.vod();
    if (!v) return [];
    const clips = this.clips();
    const r = this.rapport();
    const enLigne = clips.filter((c) => c.status === 'UPLOADED').length;
    const approuves = clips.filter((c) => ['APPROVED', 'UPLOADING', 'UPLOADED'].includes(c.status)).length;

    let source = 'Importée';
    if (v.status === 'DOWNLOADING') source = 'Téléchargement ' + (this.downloadProgress() ?? 0) + ' %';
    else if (v.status === 'FAILED') source = 'Échec du téléchargement';
    else if (!v.filePath) source = 'Fichier source supprimé';
    else if (v.fileSize) source = 'Importée, ' + this.fmtGo(v.fileSize);

    const liste = [
      {
        titre: 'Source',
        fait: clips.length > 0 || (!!v.filePath && !['DOWNLOADING', 'FAILED', 'PENDING'].includes(v.status)),
        detail: source,
      },
      {
        titre: 'Calibrage',
        fait: !!v.recordedAt,
        detail: v.recordedAt ? 'Début ' + new Date(v.recordedAt).toISOString().slice(11, 19) + ' UTC' : "À faire avant l'analyse",
      },
      {
        titre: 'Analyse',
        fait: !!r,
        detail: r ? r.setsFromVideo + ' sets sur ' + r.setsTotal + ' exacts' : this.analyseEnCours() ? 'En cours…' : 'Détecte les games',
      },
      {
        titre: 'Clips',
        fait: clips.length > 0,
        detail: clips.length ? clips.length + ' générés, ' + approuves + ' approuvés' : this.generationLancee() ? 'Génération…' : 'Un clip par set',
      },
      {
        titre: 'YouTube',
        fait: clips.length > 0 && enLigne === clips.length,
        detail: clips.length ? enLigne + ' en ligne sur ' + clips.length : 'Titre, miniature, playlist',
      },
    ];
    const courante = liste.findIndex((e) => !e.fait);
    return liste.map((e, i) => ({
      ...e,
      numero: i + 1,
      etat: e.fait ? 'fait' : i === courante ? 'encours' : 'afaire',
    }));
  });

  /** Chiffres clés du rapport d'alignement, pour le panneau d'analyse. */
  readonly resumeAnalyse = computed(() => {
    const r = this.rapport();
    if (!r) return null;
    const attribuees = r.aligned.reduce((n, a) => n + a.games.length, 0);
    return {
      exacts: r.setsFromVideo,
      total: r.setsTotal,
      attribuees,
      detectees: r.candidatesDetected,
      orphelins: r.orphans?.length ?? Math.max(0, r.candidatesDetected - attribuees),
      ecart: this.fmtEcart(r.biasSeconds),
      fiabilite: this.fmtConf(r.biasConfidence),
      partiels: r.setsPartial,
      nonDetectes: r.setsFromApiOnly,
    };
  });

  /** Positions des sets, des orphelins et des heures sur la chronologie, en %. */
  readonly frise = computed(() => {
    const r = this.rapport();
    const d = this.dureeVod();
    if (!r || d <= 0) return null;
    const pct = (s: number) => Math.max(0, Math.min(100, (s / d) * 100));
    const heures: { label: string; l: number }[] = [];
    for (let h = 0; h * 3600 < d; h++) heures.push({ label: h + ' h', l: pct(h * 3600) });
    return {
      segments: r.aligned
        .filter((a) => a.source !== 'api')
        .map((a) => ({
          cle: a.set.setStartGGId,
          l: pct(a.startSeconds),
          w: Math.max(0.2, pct(a.endSeconds) - pct(a.startSeconds)),
          partiel: a.source === 'video-partial',
          debut: a.startSeconds,
          titre: a.set.roundName + ' — ' + a.set.players,
        })),
      orphelins: (r.orphans ?? []).map((o, i) => ({ cle: i, l: pct(o.startSeconds) })),
      heures,
    };
  });

  fmtGo(octets: number): string {
    return (octets / 1e9).toFixed(1).replace('.', ',') + ' Go';
  }

  /** Confiance au format français, deux décimales. */
  fmtConf(c: number): string {
    return c.toFixed(2).replace('.', ',');
  }

  /** Écart signé en minutes et secondes : −18:41. */
  fmtEcart(secondes: number): string {
    const s = Math.abs(Math.round(secondes));
    const signe = secondes < 0 ? '−' : '+';
    return signe + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  clipCount(status: string) {
    return status === 'ALL' ? this.clips().length : this.clips().filter(c => c.status === status).length;
  }

  private manualDragging: 'start' | 'end' | null = null;

  isLocalVod(): boolean {
    const url = this.vod()?.sourceUrl ?? '';
    return url.startsWith('local:') || url.startsWith('/');
  }

  thumbPos(pct: number): string {
    return `calc(8px + ${pct / 100} * (100% - 16px))`;
  }

  manualStartPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.manualStart() / d) * 100 : 0;
  }
  manualEndPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.manualEnd() / d) * 100 : 100;
  }
  vodCurrentPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.vodCurrentTime() / d) * 100 : 0;
  }

  private pollInterval: any = null;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.api.getVod(id).subscribe({
      next: (v) => {
        this.vod.set(v);
        this.loading.set(false);
        if (v.recordedAt) {
          this.importRecordedAt = Math.floor(new Date(v.recordedAt).getTime() / 1000);
        }
        this.startPollingIfNeeded(v.status, id);
      },
      error: () => this.loading.set(false),
    });
    this.api.getClips(id).subscribe({ next: (c) => this.clips.set(c) });
    this.chargerRapportExistant(id);
  }

  ngOnDestroy() {
    this.stopPolling();
    this.arreterSondage();
  }

  startEditName(v: Vod) {
    this.editNameValue = v.name ?? '';
    this.editingName.set(true);
  }

  saveName() {
    const v = this.vod();
    if (!v) return;
    this.editingName.set(false);
    const name = this.editNameValue.trim();
    if (name === (v.name ?? '')) return;
    this.api.updateVod(v.id, { name }).subscribe({
      next: (updated) => this.vod.set({ ...v, ...updated, tournamentSlug: v.tournamentSlug }),
    });
  }

  remux() {
    const v = this.vod();
    if (!v) return;
    this.remuxing.set(true);
    this.api.remuxVod(v.id).subscribe({
      next: () => {
        this.remuxing.set(false);
        // Backend sets status to PROCESSING → polling will pick it up
        this.vod.set({ ...v, status: 'PROCESSING' });
        this.startPollingIfNeeded('PROCESSING', v.id);
      },
      error: () => this.remuxing.set(false),
    });
  }

  private startPollingIfNeeded(status: string, id: string) {
    if (['DOWNLOADING', 'PROCESSING'].includes(status)) {
      this.stopPolling();
      this.pollInterval = setInterval(() => {
        this.api.getVod(id).subscribe((v) => {
          const prevStatus = this.vod()?.status;
          this.vod.set(v);
          if (v.status === 'DOWNLOADING') {
            this.api.getDownloadProgress(id).subscribe((p) => this.downloadProgress.set(p.progress));
          }
          if (v.status === 'PROCESSING') {
            this.api.getClips(id).subscribe((c) => this.clips.set(c));
          }
          if (!['DOWNLOADING', 'PROCESSING'].includes(v.status)) {
            this.downloadProgress.set(null);
            this.clipsAttendus.set(0);
            this.stopPolling();
            this.api.getClips(id).subscribe((c) => {
              this.clips.set(c);
              // Remux vient de se terminer → recharger la source vidéo
              if (prevStatus === 'PROCESSING' && c.length === 0) {
                setTimeout(() => this.vodVideoEl?.nativeElement?.load(), 500);
              }
            });
          }
        });
      }, 2000);
    }
  }

  private stopPolling() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
  }

  onVodMetadata() {
    const v = this.vodVideoEl?.nativeElement;
    if (!v) return;
    const dur = v.duration;
    if (isFinite(dur)) {
      this.vodDuration.set(dur);
      this.manualEnd.set(Math.min(300, dur)); // default to first 5 min
    }
  }

  onVodTimeUpdate() {
    const v = this.vodVideoEl?.nativeElement;
    if (v) this.vodCurrentTime.set(v.currentTime);
  }

  setManualStartFromCurrent() {
    const t = Math.floor(this.vodCurrentTime());
    this.manualStart.set(t);
    if (this.manualEnd() <= t) this.manualEnd.set(Math.min(t + 300, this.vodDuration()));
  }

  setManualEndFromCurrent() {
    const t = Math.floor(this.vodCurrentTime());
    if (t > this.manualStart()) this.manualEnd.set(t);
  }

  onManualPointerDown(e: PointerEvent, track: HTMLElement) {
    const rect = track.getBoundingClientRect();
    const usableWidth = rect.width - 16;
    const x = e.clientX - rect.left - 8;
    const pct = Math.max(0, Math.min(1, x / usableWidth));
    const val = pct * this.vodDuration();
    const distStart = Math.abs(val - this.manualStart());
    const distEnd = Math.abs(val - this.manualEnd());
    this.manualDragging = distStart <= distEnd ? 'start' : 'end';
    (track as any).setPointerCapture(e.pointerId);
    track.addEventListener('pointermove', this.onManualPointerMove);
    track.addEventListener('pointerup', this.onManualPointerUp);
    this.applyManualDrag(pct);
  }

  private onManualPointerMove = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left - 8) / (rect.width - 16)));
    this.applyManualDrag(pct);
  };

  private onManualPointerUp = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    track.removeEventListener('pointermove', this.onManualPointerMove);
    track.removeEventListener('pointerup', this.onManualPointerUp);
    this.manualDragging = null;
  };

  private applyManualDrag(pct: number) {
    const dur = this.vodDuration();
    const val = pct * dur;
    if (this.manualDragging === 'start') {
      this.manualStart.set(Math.max(0, Math.min(val, this.manualEnd() - 1)));
      const v = this.vodVideoEl?.nativeElement;
      if (v) v.currentTime = this.manualStart();
    } else if (this.manualDragging === 'end') {
      this.manualEnd.set(Math.max(this.manualStart() + 1, Math.min(val, dur)));
      const v = this.vodVideoEl?.nativeElement;
      if (v) v.currentTime = this.manualEnd();
    }
  }

  onManualStartInput(e: Event) {
    const val = this.fromHMS((e.target as HTMLInputElement).value);
    if (!isNaN(val)) this.manualStart.set(Math.max(0, Math.min(val, this.manualEnd() - 1)));
  }

  onManualEndInput(e: Event) {
    const val = this.fromHMS((e.target as HTMLInputElement).value);
    if (!isNaN(val)) this.manualEnd.set(Math.max(this.manualStart() + 1, Math.min(val, this.vodDuration())));
  }

  createManualClip() {
    const v = this.vod();
    if (!v) return;
    this.creatingManualClip.set(true);
    this.api.createManualClip(v.id, {
      startSeconds: Math.floor(this.manualStart()),
      endSeconds: Math.floor(this.manualEnd()),
      title: this.manualTitle || undefined,
    }).subscribe({
      next: () => {
        this.creatingManualClip.set(false);
        this.manualTitle = '';
        this.manualClipMsg.set('Clip en cours de génération...');
        setTimeout(() => {
          this.manualClipMsg.set('');
          this.api.getClips(v.id).subscribe((c) => this.clips.set(c));
        }, 4000);
      },
      error: () => this.creatingManualClip.set(false),
    });
  }

  applySharedDescription() {
    const desc = this.sharedDescription.trim();
    if (!desc) return;
    const clips = this.clips();
    if (clips.length === 0) return;
    this.applyingDescription.set(true);
    let done = 0;
    clips.forEach(clip => {
      this.api.updateClip(clip.id, { description: desc }).subscribe({
        next: () => {
          done++;
          if (done === clips.length) {
            this.applyingDescription.set(false);
            this.sharedDescriptionMsg.set(`Description appliquée à ${clips.length} clip${clips.length > 1 ? 's' : ''}.`);
            setTimeout(() => this.sharedDescriptionMsg.set(''), 3000);
          }
        },
        error: () => {
          done++;
          if (done === clips.length) this.applyingDescription.set(false);
        },
      });
    });
  }

  retryDownload() {
    const v = this.vod();
    if (!v) return;
    this.retryingDownload.set(true);
    this.api.retryVodDownload(v.id).subscribe({
      next: () => {
        this.retryingDownload.set(false);
        this.downloadProgress.set(0);
        this.vod.set({ ...v, status: 'DOWNLOADING' });
        this.startPollingIfNeeded('DOWNLOADING', v.id);
      },
      error: () => this.retryingDownload.set(false),
    });
  }

  deleteClip(e: Event, clipId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Supprimer ce clip ?')) return;
    this.deletingClipId.set(clipId);
    this.api.deleteClip(clipId).subscribe({
      next: () => {
        this.deletingClipId.set(null);
        this.clips.update(c => c.filter(x => x.id !== clipId));
        this.selectedClipIds.update(s => { s.delete(clipId); return new Set(s); });
      },
      error: () => this.deletingClipId.set(null),
    });
  }

  toggleClipSelection(clipId: string) {
    this.selectedClipIds.update(s => {
      const next = new Set(s);
      if (next.has(clipId)) { next.delete(clipId); } else { next.add(clipId); }
      return next;
    });
  }

  isSelected(clipId: string): boolean {
    return this.selectedClipIds().has(clipId);
  }

  toggleSelectAll() {
    const visible = this.filteredClips().map(c => c.id);
    const allSelected = visible.every(id => this.selectedClipIds().has(id));
    if (allSelected) {
      this.selectedClipIds.update(s => { const n = new Set(s); visible.forEach(id => n.delete(id)); return n; });
    } else {
      this.selectedClipIds.update(s => new Set([...s, ...visible]));
    }
  }

  clearSelection() {
    this.selectedClipIds.set(new Set());
  }

  bulkApprove() {
    const ids = [...this.selectedClipIds()];
    if (!ids.length) return;
    this.bulkActing.set(true);
    forkJoin(ids.map(id => this.api.updateClip(id, { status: 'APPROVED' }))).subscribe({
      next: () => {
        this.clips.update(cs => cs.map(c => ids.includes(c.id) ? { ...c, status: 'APPROVED' } : c));
        this.clearSelection();
        this.bulkActing.set(false);
      },
      error: () => this.bulkActing.set(false),
    });
  }

  bulkDisapprove() {
    const ids = [...this.selectedClipIds()];
    if (!ids.length) return;
    this.bulkActing.set(true);
    forkJoin(ids.map(id => this.api.updateClip(id, { status: 'PENDING' }))).subscribe({
      next: () => {
        this.clips.update(cs => cs.map(c => ids.includes(c.id) ? { ...c, status: 'PENDING' } : c));
        this.clearSelection();
        this.bulkActing.set(false);
      },
      error: () => this.bulkActing.set(false),
    });
  }

  bulkDelete() {
    const ids = [...this.selectedClipIds()];
    if (!ids.length) return;
    if (!confirm(`Supprimer ${ids.length} clip(s) ?`)) return;
    this.bulkActing.set(true);
    forkJoin(ids.map(id => this.api.deleteClip(id))).subscribe({
      next: () => {
        this.clips.update(cs => cs.filter(c => !ids.includes(c.id)));
        this.clearSelection();
        this.bulkActing.set(false);
      },
      error: () => this.bulkActing.set(false),
    });
  }

  fetchTimestamp() {
    const v = this.vod();
    if (!v) return;
    // L'URL saisie prime ; sinon on retombe sur l'URL source de la VOD.
    const url = this.timestampUrl.trim() || undefined;
    if (this.isLocalVod() && !url) return;
    this.fetchingTimestamp.set(true);
    this.api.fetchVodTimestamp(v.id, url).subscribe({
      next: ({ timestamp }) => {
        this.importRecordedAt = timestamp;
        this.fetchingTimestamp.set(false);
      },
      error: () => this.fetchingTimestamp.set(false),
    });
  }

  openImportSets() {
    this.showImportSets.set(!this.showImportSets());
    if (this.showImportSets() && this.vod()?.eventStartGGId && !this.importRecordedAt && !this.calibrationSets().length) {
      this.loadCalibrationSets();
    }
  }

  resetTimestamp() {
    this.importRecordedAt = 0;
    this.calibrationMsg.set('');
    if (this.vod()?.eventStartGGId && !this.calibrationSets().length) {
      this.loadCalibrationSets();
    }
  }

  estimateFromSets() {
    const eventId = this.vod()?.eventStartGGId;
    if (!eventId) return;
    this.estimatingTimestamp.set(true);
    this.api.getStartGGEventSets(eventId).subscribe({
      next: ({ sets }) => {
        const withTime = sets.filter(s => !!s.startTime);
        if (!withTime.length) {
          this.estimatingTimestamp.set(false);
          this.calibrationMsg.set('Aucun set avec timestamp disponible.');
          return;
        }
        const earliest = Math.min(...withTime.map(s => Math.floor(new Date(s.startTime!).getTime() / 1000)));
        this.importRecordedAt = earliest - 900;
        this.calibrationMsg.set(`⏱ Estimation : stream démarré ~15 min avant le 1er set (${new Date(this.importRecordedAt * 1000).toLocaleString('fr-FR')})`);
        this.estimatingTimestamp.set(false);
      },
      error: () => this.estimatingTimestamp.set(false),
    });
  }

  retryClip(clipId: string) {
    this.retryingClipId.set(clipId);
    this.api.retryClip(clipId).subscribe({
      next: () => {
        this.retryingClipId.set(null);
        const id = this.vod()!.id;
        setTimeout(() => this.api.getClips(id).subscribe((c) => this.clips.set(c)), 1000);
      },
      error: () => this.retryingClipId.set(null),
    });
  }

  deleteSourceFile() {
    const v = this.vod();
    if (!v || !v.filePath) return;
    if (!confirm('Supprimer le fichier source de la VOD ? Les clips générés seront conservés.')) return;
    this.deletingSourceFile.set(true);
    this.api.deleteVodSourceFile(v.id).subscribe({
      next: () => {
        this.deletingSourceFile.set(false);
        this.vod.set({ ...v, filePath: undefined });
      },
      error: (err) => {
        this.deletingSourceFile.set(false);
        alert(err?.error?.message ?? 'Erreur lors de la suppression du fichier');
      },
    });
  }

  deleteVod() {
    if (!confirm('Supprimer cette VOD et tous ses clips ?')) return;
    const id = this.vod()!.id;
    this.api.deleteVod(id).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => alert(err?.error?.message ?? 'Erreur lors de la suppression'),
    });
  }

  /**
   * Chaînes de diffusion présentes dans les sets, avec leur nombre de sets.
   *
   * Un gros tournoi diffuse sur plusieurs chaînes en parallèle, par exemple
   * `vgbootcamp`, `vgbootcamp2` et `vgbootcamp4` pour un même event. Se tromper
   * de chaîne vidait la liste sans rien expliquer.
   */
  calibrationStreams = computed(() => {
    const comptes = new Map<string, number>();
    for (const s of this.calibrationSets()) {
      const nom = s.stream?.streamName?.trim();
      if (nom) comptes.set(nom, (comptes.get(nom) ?? 0) + 1);
    }
    return [...comptes.entries()]
      .map(([nom, nombre]) => ({ nom, nombre }))
      .sort((a, b) => b.nombre - a.nombre);
  });

  /**
   * Regroupe les sets de la chaîne choisie par phase du tournoi, et affiche
   * l'heure Start.gg de chacun pour aider à retrouver celui qu'on voit à
   * l'écran.
   */
  calibrationSetsParPhase = computed(() => {
    const groupes = new Map<string, Array<StartGGSetPreview & { heure: string }>>();
    const chaine = this.selectedCalibrationStream().trim().toLowerCase();
    const recherche = normaliser(this.calibrationSearch());

    for (const s of this.calibrationSets()) {
      if (chaine && s.stream?.streamName?.trim().toLowerCase() !== chaine) continue;

      if (recherche) {
        const cible = normaliser(
          `${s.player1?.name} ${s.player2?.name} ${s.roundName} ${s.phaseName}`,
        );
        if (!cible.includes(recherche)) continue;
      }
      const nom = s.phaseName?.trim() || 'Sans phase';
      const heure = s.startTime
        ? new Date(s.startTime).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '--:--';
      if (!groupes.has(nom)) groupes.set(nom, []);
      groupes.get(nom)!.push({ ...s, heure });
    }

    return [...groupes.entries()].map(([nom, sets]) => ({ nom, sets }));
  });

  /** Nombre de sets actuellement proposés, chaîne et recherche appliquées. */
  calibrationSetsAffiches = computed(() =>
    this.calibrationSetsParPhase().reduce((n, p) => n + p.sets.length, 0),
  );

  /** Sets qui passeront le seuil de confiance à la génération. */
  setsRetenus(): number {
    const r = this.rapport();
    if (!r) return 0;
    return r.aligned.filter(
      (a) => a.source !== 'api' && a.set.gameCount !== 0 && a.confidence >= this.minConfiance,
    ).length;
  }

  /**
   * Lance l'analyse puis interroge le rapport jusqu'à ce qu'il change.
   *
   * Le traitement tourne dans une file côté serveur et peut durer plusieurs
   * minutes sur une longue VOD, d'où le sondage plutôt qu'une attente bloquante.
   */
  lancerAnalyse() {
    const v = this.vod();
    if (!v || this.analyseEnCours()) return;

    const precedent = this.rapport()?.generatedAt ?? null;
    this.analyseEnCours.set(true);
    this.analyseErreur.set(false);
    this.analyseMsg.set('Analyse lancée. Le décodage dure environ une minute par heure de vidéo.');

    this.api.alignVod(v.id).subscribe({
      next: () => this.sonderAnalyse(v.id, precedent),
      error: (err) => {
        this.analyseEnCours.set(false);
        this.analyseErreur.set(true);
        this.analyseMsg.set(err?.error?.message ?? "Impossible de lancer l'analyse.");
      },
    });
  }

  private sonderAnalyse(vodId: string, precedent: string | null) {
    this.arreterSondage();
    let essais = 0;
    this.sondageAnalyse = setInterval(() => {
      essais++;
      this.api.getAlignment(vodId).subscribe({
        next: (r) => {
          // `null` tant que l'analyse n'a rien écrit : on attend le tour suivant.
          if (!r || r.generatedAt === precedent) return;
          this.arreterSondage();
          this.rapport.set(r);
          this.analyseEnCours.set(false);
          this.analyseMsg.set(
            `Analyse terminée : ${r.setsFromVideo} set(s) calés sur la vidéo sur ${r.setsTotal}.`,
          );
        },
        error: () => { /* incident réseau : on réessaie au prochain tour */ },
      });
      if (essais > 120) {
        this.arreterSondage();
        this.analyseEnCours.set(false);
        this.analyseErreur.set(true);
        this.analyseMsg.set('Analyse toujours en cours après 10 minutes. Recharge la page pour voir le résultat.');
      }
    }, 5000);
  }

  private arreterSondage() {
    if (this.sondageAnalyse) {
      clearInterval(this.sondageAnalyse);
      this.sondageAnalyse = null;
    }
  }

  genererDepuisAnalyse() {
    const v = this.vod();
    if (!v || this.generationEnCours()) return;

    this.generationEnCours.set(true);
    this.analyseErreur.set(false);
    this.api.generateClipsFromAlignment(v.id, { minConfidence: this.minConfiance }).subscribe({
      next: (res) => {
        this.generationEnCours.set(false);
        this.analyseMsg.set(res.message);
        const attendus = res.enqueuedSets ?? 0;
        if (attendus > 0) {
          this.clipsAuDebut.set(this.clips().length);
          this.clipsAttendus.set(attendus);
          this.vod.set({ ...v, status: 'PROCESSING' });
          this.startPollingIfNeeded('PROCESSING', v.id);
        }
      },
      error: (err) => {
        this.generationEnCours.set(false);
        this.analyseErreur.set(true);
        this.analyseMsg.set(err?.error?.message ?? 'Échec de la génération.');
      },
    });
  }

  /** Rapport déjà calculé, s'il existe. L'API renvoie `null` sinon. */
  private chargerRapportExistant(vodId: string) {
    this.api.getAlignment(vodId).subscribe({
      next: (r) => this.rapport.set(r),
      error: () => this.rapport.set(null),
    });
  }

  loadCalibrationSets() {
    const eventId = this.vod()?.eventStartGGId;
    if (!eventId) return;
    this.loadingCalibrationSets.set(true);
    this.calibrationMsg.set('');
    // Seuls les sets passés à l'antenne peuvent servir de repère visuel. Sur une
    // affiche comme UFA, ça fait passer la liste de près de mille à cinquante.
    // On ne filtre pas sur la chaîne de la VOD : l'utilisateur la choisit
    // ensuite dans la liste, ce qui lui évite d'avoir à la deviner.
    this.api.getStartGGEventSets(eventId, { onStreamOnly: true }).subscribe({
      next: ({ sets }) => {
        this.calibrationSets.set(
          sets
            .filter(s => !!s.startTime)
            .sort((a, b) => new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime()),
        );

        // Présélection : la chaîne déjà associée à la VOD si elle existe parmi
        // celles trouvées, sinon celle qui a diffusé le plus de sets.
        const chaines = this.calibrationStreams();
        const actuelle = this.vod()?.streamName?.trim().toLowerCase();
        this.selectedCalibrationStream.set(
          chaines.find(c => c.nom.toLowerCase() === actuelle)?.nom ??
            chaines[0]?.nom ??
            '',
        );

        this.loadingCalibrationSets.set(false);
      },
      error: () => this.loadingCalibrationSets.set(false),
    });
  }

  calibrateFromSet() {
    const set = this.calibrationSets().find(s => s.id === this.selectedCalibrationSetId);
    if (!set?.startTime) return;
    const setUnix = Math.floor(new Date(set.startTime).getTime() / 1000);
    const videoPos = Math.floor(this.vodCurrentTime());
    this.importRecordedAt = setUnix - videoPos;
    this.calibrationMsg.set(`Calage : stream démarré le ${new Date(this.importRecordedAt * 1000).toLocaleString('fr-FR')}`);

    // Le calage est enregistré tout de suite, et pas seulement au moment de
    // l'import : c'est lui qui conditionne l'analyse vidéo, et l'ancien import
    // ne doit plus être un passage obligé pour l'activer.
    //
    // La chaîne du set est enregistrée avec, car c'est elle qui filtrera les
    // sets au découpage. La laisser désynchronisée renverrait zéro set.
    const v = this.vod();
    if (!v) return;

    const chaine = set.stream?.streamName?.trim();
    const recordedAt = new Date(this.importRecordedAt * 1000).toISOString();
    const maj: Partial<Vod> = { recordedAt };
    if (chaine && chaine !== v.streamName) maj.streamName = chaine;

    this.api.updateVod(v.id, maj).subscribe({
      next: () => {
        this.vod.set({ ...v, ...maj });
        this.calibrationMsg.set(
          `Calage enregistré : stream démarré le ${new Date(this.importRecordedAt * 1000).toLocaleString('fr-FR')}. Tu peux lancer l'analyse.`,
        );
      },
      error: () =>
        this.calibrationMsg.set(
          "Calage calculé mais non enregistré. Réessaie avant de lancer l'analyse.",
        ),
    });
  }

  // ── Inline clip recut ──────────────────────────────────────────────

  toHMS(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  fromHMS(value: string): number {
    const parts = value.trim().split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  recutStartPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.recutStart() / d) * 100 : 0;
  }

  recutEndPct() {
    const d = this.vodDuration();
    return d > 0 ? (this.recutEnd() / d) * 100 : 100;
  }

  toggleClipRecut(clip: Clip) {
    if (this.expandedClipId() === clip.id) {
      this.expandedClipId.set(null);
      return;
    }
    this.expandedClipId.set(clip.id);
    this.recutStart.set(clip.startSeconds);
    this.recutEnd.set(clip.endSeconds);
    this.recutMsg.set('');
    this.seekMainVideo(clip.startSeconds);
    setTimeout(() => {
      this.vodVideoEl?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  seekMainVideo(t: number) {
    const video = this.vodVideoEl?.nativeElement;
    if (video) video.currentTime = Math.max(0, t);
  }

  setClipRecutFromCurrent(which: 'start' | 'end') {
    const t = Math.floor(this.vodCurrentTime());
    if (which === 'start') {
      this.recutStart.set(Math.min(t, this.recutEnd() - 1));
    } else {
      if (t > this.recutStart()) this.recutEnd.set(t);
    }
  }

  onClipRecutPointerDown(e: PointerEvent) {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left - 8) / (rect.width - 16)));
    const val = pct * this.vodDuration();
    const distStart = Math.abs(val - this.recutStart());
    const distEnd = Math.abs(val - this.recutEnd());
    this.clipRecutDragging = distStart <= distEnd ? 'start' : 'end';
    (track as any).setPointerCapture(e.pointerId);
    track.addEventListener('pointermove', this.onClipRecutPointerMove);
    track.addEventListener('pointerup', this.onClipRecutPointerUp);
    this.applyClipRecutDrag(pct);
  }

  private onClipRecutPointerMove = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left - 8) / (rect.width - 16)));
    this.applyClipRecutDrag(pct);
  };

  private onClipRecutPointerUp = (e: PointerEvent) => {
    const track = e.currentTarget as HTMLElement;
    track.removeEventListener('pointermove', this.onClipRecutPointerMove);
    track.removeEventListener('pointerup', this.onClipRecutPointerUp);
    this.clipRecutDragging = null;
  };

  private applyClipRecutDrag(pct: number) {
    const dur = this.vodDuration();
    const val = pct * dur;
    if (this.clipRecutDragging === 'start') {
      this.recutStart.set(Math.max(0, Math.min(val, this.recutEnd() - 1)));
      this.seekMainVideo(this.recutStart());
    } else if (this.clipRecutDragging === 'end') {
      this.recutEnd.set(Math.max(this.recutStart() + 1, Math.min(val, dur)));
      this.seekMainVideo(this.recutEnd());
    }
  }

  onClipRecutStartInput(e: Event) {
    const val = this.fromHMS((e.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      this.recutStart.set(Math.max(0, Math.min(val, this.recutEnd() - 1)));
      this.seekMainVideo(this.recutStart());
    }
  }

  onClipRecutEndInput(e: Event) {
    const val = this.fromHMS((e.target as HTMLInputElement).value);
    if (!isNaN(val)) {
      this.recutEnd.set(Math.max(this.recutStart() + 1, Math.min(val, this.vodDuration())));
      this.seekMainVideo(this.recutEnd());
    }
  }

  applyClipRecut(clipId: string) {
    this.recutting.set(true);
    this.recutMsg.set('');
    this.api.recutClip(clipId, Math.floor(this.recutStart()), Math.floor(this.recutEnd())).subscribe({
      next: (updated) => {
        this.recutting.set(false);
        this.recutMsg.set('Recoupe lancée.');
        this.clips.update(cs => cs.map(c => c.id === clipId ? { ...c, startSeconds: updated.startSeconds, endSeconds: updated.endSeconds } : c));
        setTimeout(() => { this.recutMsg.set(''); this.expandedClipId.set(null); }, 3000);
      },
      error: () => {
        this.recutting.set(false);
        this.recutMsg.set('Erreur lors du recut');
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────

  unixToLocale(ts: number): string {
    return new Date(ts * 1000).toLocaleString('fr-FR');
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    return m + ':' + s.toString().padStart(2, '0');
  }

  formatDuration(start: number, end: number): string {
    return Math.round((end - start) / 60) + ' min';
  }

  vodLabel(status: string): string {
    if (status === 'PROCESSING' && this.clips().length > 0) return 'Génération des clips';
    return statutVod(status).label;
  }



}
