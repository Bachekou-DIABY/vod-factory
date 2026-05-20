# VOD-Factory — Plan de Développement

## Contexte Projet

**VOD-Factory** est une plateforme d'indexation et de découpage automatisé de VODs e-sport, avec focus sur Super Smash Bros. Ultimate.

- **Stack** : Monorepo Nx, NestJS (back), Angular 21 (front), Prisma (PostgreSQL), BullMQ (Redis), FFmpeg, yt-dlp
- **Architecture** : Clean Architecture / Hexagonale
- **Cible** : usage interne pour TOs (Tournois Operators)
- **Production** : `vod.bdiaby.fr` — VPS ARM, Docker Compose, HTTPS

---

## Ce qui a été fait

### Socle technique
- Nx 22.5.4, structure `/apps`, CI/CD GitHub Actions
- NestJS + Clean Architecture (`domain/`, `application/`, `infrastructure/`)
- DIP via tokens NestJS, Mappers Prisma ↔ Domaine
- PostgreSQL via Docker, schéma `Tournament`, `Player`, `Set`, `Vod`, `Clip`, `YoutubeAccount`

### Intégration Start.gg
- `IStartGGService` + `StartGGService` (GraphQL via Axios)
- `ImportTournamentUseCase` + `ImportSetsUseCase`
- Pagination complète (> 50 sets via `paginateEventSets()`)
- Filtres par jeux, ordonnancement par `startedAt`

### Pipeline vidéo
- `YtDlpDownloadService` : téléchargement yt-dlp 1080p + merge AAC 192k
- BullMQ download queue (`VodDownloadProcessor`)
- Import VOD locale depuis l'UI (upload fichier multipart)
- `FfprobeService` : durée/résolution réelles après download
- `ClipSetProcessor` : BullMQ, concurrency 4, 1 job par set
- `GenerateClipsFromTimestampsUseCase` : timestamps Start.gg → clips
- `-movflags +faststart` sur tous les clips
- Détection HUD timer (% pixels blancs zone top-right, state machine)
- Suppression fichier source VOD (`DELETE /api/vods/:id/file`)

### Frontend Angular
- Page tournois : liste, import Start.gg, ajout VOD, onglet Archives, gestion comptes YouTube
- Page VOD : lecteur vidéo, recut inline ancré sous le player, timer hh:mm:ss pour clips manuels, description commune aux clips, filtre clips par statut, sélection respecte le filtre actif, import sets Start.gg
- Page clip-review : lecteur clip, recut dual-handle, approbation, édition titre/round/joueurs/score, miniature custom, visibilité YouTube
- Page "Clips approuvés" : upload batch avec création playlist (visibilité + description), upload individuel, polling statut, téléchargement

### YouTube
- OAuth2 Google, tokens stockés en base (`YoutubeAccount`)
- Multi-comptes (connexion/déconnexion depuis l'UI)
- Upload avec `videos.insert` + `thumbnails.set` + `playlistItems.insert`
- Playlist par tournoi : création avec visibilité + description avant le batch upload, réutilisation si existante
- Fix race condition playlist (re-fetch tournoi avant création)

### Archivage
- Champ `archivedAt` sur `Tournament`
- Endpoints `PATCH /archive` et `PATCH /unarchive`
- Onglet "Archives" sur la page tournois

---

## Reste à faire

### Priorité haute
- **Authentification** : login/mot de passe pour protéger l'accès à vod.bdiaby.fr avant ouverture à des TOs
  - À définir : liste de tournois commune ou par utilisateur ?
- **Sélecteur de chaîne YouTube** : si plusieurs comptes connectés, permettre de choisir sur quelle chaîne uploader (actuellement prend toujours le premier compte)
- **Skip playlist form si playlist existante** : si `tournament.youtubePlaylistId` est déjà défini, ne pas proposer le formulaire de création et uploader directement

### Priorité moyenne
- **Réordonnancement des clips** : drag-and-drop ou flèches haut/bas, mise à jour de `setOrder` en base
- **Fix bad gateway** à l'import VOD (URL ou fichier local) — instable en prod
- **Fix refresh obligatoire** après ajout tournoi / import VOD (pas de mise à jour réactive)

### Priorité basse
- **Purge manuelle** des VODs et clips (bouton avec confirmation, pas d'auto-delete)
- **Améliorer le référencement YouTube** : tags automatiques (ex: "SSBU Tournament"), description type par défaut
- **Usage en live** : yt-dlp supporte `--live-from-start`, mais c'est un mode de fonctionnement à part entière
- **Supprimer le bouton "Corriger le format"** : l'auto-remux à l'upload devrait rendre ce bouton inutile à terme. Le retirer une fois qu'on a confiance que tous les formats sont bien gérés (MP4 faststart systématique, fallback MPEG-TS). Garder uniquement pour les VODs importées avant ce fix.

### UX streamlinée (import VOD + génération clips)
- **VOD depuis URL Twitch** : le timestamp est récupéré automatiquement en arrière-plan → afficher un bandeau "Timestamp détecté, voulez-vous générer les clips ?" dès que la VOD est téléchargée, avec deux options : générer auto ou configurer manuellement. ✅ Bandeau implémenté.
- **VOD depuis upload local (sans URL)** : interface de calibration guidée — afficher les premiers sets Start.gg (triés par `startedAt` ascending), l'utilisateur cherche lequel correspond au début de sa vidéo, se positionne dessus, confirme. ✅ Calibration par set implémentée, sets maintenant triés chronologiquement.

---

## Pistes explorées, non retenues

- **Selenium / Playwright pour l'upload YouTube** : envisagé pour contourner les quotas API. Abandonné au profit de l'API officielle (googleapis) pour fiabilité et maintenabilité.
- **OCR Tesseract pour la détection de jeu** : trop lent et peu fiable sur des frames SSBU. Remplacé par la détection HUD timer (analyse % pixels blancs).
- **Association YouTube par tournoi** : chaque tournoi pouvait avoir sa propre chaîne YouTube associée. Sur-ingénierie pour le cas d'usage actuel — simplifié à "premier compte disponible".
- **Multi-utilisateurs avec chaîne YouTube par utilisateur** : envisagé avec un champ `youtubeAccountId` sur `Tournament`. Mis de côté en attendant l'implémentation de l'auth.

---

## Stack Technique

| Couche | Technologie |
|--------|-------------|
| Monorepo | Nx 22.5.4 |
| Backend | NestJS 11, TypeScript 5.9 |
| Frontend | Angular 21, Tailwind CSS |
| Base de données | PostgreSQL 15, Prisma 5.22 |
| Queue / Jobs | Redis + BullMQ (concurrency 4) |
| Vidéo | FFmpeg, fluent-ffmpeg 2.x, yt-dlp |
| YouTube | googleapis (OAuth2 + YouTube Data API v3) |

---

## Historique

**18-19/03/2026** : Socle Nx/NestJS, Prisma, Start.gg GraphQL, pipeline OCR (puis abandon Tesseract → HUD timer)

**20/03/2026** : Multi-set clipping, BullMQ workers parallèles, Clip model, nettoyage git (6.7 GB purgés)

**23-24/03/2026** : Angular frontend complet, clip-review UI, streaming vidéo, YouTube OAuth upload, remux faststart, thumbnail custom, fix recut Windows

**24/03/2026** : Backlog terminé — ffprobe, BullMQ download queue, suppression fichier source VOD, import VOD local

**02-14/04/2026** : YouTube multi-comptes (tokens en DB), recut inline ancré sous le player VOD, inputs hh:mm:ss pour clips manuels, description commune aux clips, filtre/sélection clips par statut, playlist YouTube avec visibilité + description, fix race condition playlist, archivage des tournois (onglet Archives)
