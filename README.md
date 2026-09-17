# VOD-Factory

Plateforme de découpage automatisé de VODs e-sport à destination des organisateurs de tournois (TOs).

À partir des données Start.gg d'un tournoi, VOD-Factory télécharge les streams, génère un clip par set, et les uploade automatiquement sur YouTube avec titre, description, miniature et playlist.

Focus initial : **Super Smash Bros. Ultimate**

---

## Stack

| Couche | Technologie |
|--------|-------------|
| Monorepo | Nx 22 |
| Backend | NestJS 11 + TypeScript |
| Frontend | Angular 21 + Tailwind CSS |
| Base de données | PostgreSQL 15 + Prisma |
| Queue | Redis + BullMQ |
| Vidéo | FFmpeg + yt-dlp |
| YouTube | googleapis (OAuth2 + YouTube Data API v3) |

---

## Fonctionnalités

- Import de tournois depuis Start.gg
- Téléchargement automatique des VODs (Twitch, YouTube) via yt-dlp, ou import de fichiers locaux
- Détection automatique des sets par analyse HUD (% pixels blancs zone timer SSBU)
- Génération des clips depuis les timestamps Start.gg (sans détection vidéo)
- Interface de review : recut dual-handle, édition titre/round/joueurs/score, miniature custom
- Recut inline depuis la liste des clips d'une VOD
- Approbation et upload YouTube en batch ou clip par clip
- Création de playlist YouTube par tournoi (visibilité + description configurables)
- Gestion multi-comptes YouTube (OAuth2, tokens en base)
- Archivage des tournois terminés
- Filtre par statut sur les clips (PENDING / APPROVED / UPLOADED / FAILED)
- Description commune applicable à tous les clips d'une VOD

---

## Prérequis

- Node.js 20+
- Docker Desktop
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installé et dans le PATH
- [FFmpeg](https://ffmpeg.org/) installé et dans le PATH

---

## Installation (développement local)

```bash
# 1. Installer les dépendances
npm install

# 2. Démarrer PostgreSQL + Redis
npm run docker:up

# 3. Créer le fichier .env dans apps/backend/
cp apps/backend/.env.example apps/backend/.env
# → renseigner DATABASE_URL, STARTGG_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FRONTEND_URL

# 4. Appliquer les migrations Prisma
npm run prisma:migrate

# 5. Générer le client Prisma
npm run prisma:generate
```

---

## Lancer le projet

```bash
# Backend (API sur http://localhost:3000/api)
npm run dev

# Frontend (UI sur http://localhost:4200)
npx nx serve frontend
```

---

## Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Lance le backend NestJS |
| `npx nx serve frontend` | Lance le frontend Angular |
| `npm run docker:up` | Démarre PostgreSQL + Redis |
| `npm run docker:down` | Arrête les containers |
| `npm run prisma:migrate` | Applique les migrations |
| `npm run prisma:generate` | Régénère le client Prisma |
| `npm run prisma:studio` | Interface visuelle base de données |

---

## Déploiement (production)

> **Mise en place Oracle Cloud en cours** — état, quotas, pièges et étapes de
> reprise dans [DEPLOIEMENT-ORACLE.md](DEPLOIEMENT-ORACLE.md).

Le projet tourne en production sur un VPS via Docker Compose (`docker-compose.production.yml`).

```bash
git pull
docker compose -f docker-compose.production.yml build backend frontend
docker compose -f docker-compose.production.yml up -d
docker exec vod-factory-backend npx prisma migrate deploy
```

---

## Configuration YouTube

1. Crée un projet sur [Google Cloud Console](https://console.cloud.google.com)
2. Active l'API **YouTube Data API v3**
3. Crée un ID client OAuth 2.0 (Application Web)
   - URI de redirection autorisée : `https://ton-domaine/api/youtube/callback`
4. Ajoute dans `.env` :
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
5. Dans l'app → page d'accueil → section **Comptes YouTube** → "Connecter une chaîne"

---

## Pipeline vidéo

```
Import tournoi (Start.gg)
  → Ajout VOD (URL ou fichier local)
    → Téléchargement yt-dlp (BullMQ)
      → Alignement sets ↔ vidéo  (ou analyse HUD seule, ou timestamps Start.gg seuls)
        → Génération clips (FFmpeg -c copy)
          → Review / recut / approbation
            → Upload YouTube (videos.insert + thumbnails.set + playlistItems.insert)
```

---

## Alignement sets ↔ vidéo

Les timestamps Start.gg sont imprécis : les TOs lancent et reportent les sets à
la main. La détection vidéo seule, elle, produit des faux positifs. Le pipeline
d'alignement combine les deux au lieu de choisir.

L'idée : Start.gg fournit la **structure** (liste ordonnée des sets on-stream,
et surtout le nombre exact de games par set via `displayScore`), la vidéo
fournit les **frontières**. Un set noté 3-1 contient quatre games : cette
contrainte suffit à éliminer les faux positifs et à savoir qu'on a raté une
game sans regarder la vidéo.

### Étapes

| Étape | Fichier | Rôle |
|-------|---------|------|
| Signal | `frame-signal.service.ts` | Une passe FFmpeg, frames en niveaux de gris streamées en rawvideo. Rien sur disque. |
| Segmentation | `alignment/segmenter.ts` | Filtre médian + hystérésis + recalage sur fondu au noir → games candidates |
| Biais | `alignment/offset-estimator.ts` | Corrélation croisée : estime le retard systématique du TO sur tout l'event |
| Alignement | `alignment/set-aligner.ts` | Programmation dynamique monotone : chaque set consomme un segment contigu de candidats |
| Rattrapage | `segmenter.resegmentWindow` | Là où il manque une game, re-segmente avec des seuils bas. Signal en mémoire, donc gratuit. |
| Validation | `timer-ocr-validator.service.ts` | OCR du timer sur 3 frames par game. Confirme, ne détecte plus. |

Le signal quantifié est stocké en base (`vods.hudSignal`, environ 60 ko pour
une journée de tournoi), ce qui permet de rejouer la segmentation avec d'autres
seuils sans redécoder la VOD.

### Endpoints

```bash
# Lancer l'alignement (asynchrone, décode la VOD une fois)
POST /api/vods/:id/align
{ "useOcrValidation": false, "reuseStoredSignal": false }

# Consulter le rapport : biais estimé, sets alignés, confiance, avertissements
GET /api/vods/:id/alignment

# Générer les clips en écartant les sets peu sûrs
POST /api/vods/:id/clips-from-alignment
{ "minConfidence": 0.45, "includeApiOnly": false }

# Diagnostic : signal HUD sous-échantillonné + histogramme, pour régler les seuils
GET /api/vods/:id/alignment/signal?points=1000
```

### Régler les seuils

La zone HUD est en dur dans `DEFAULT_HUD_ZONE` et l'overlay de chaque TO est
différent. En cas de mauvaise détection, commencer par
`GET /vods/:id/alignment/signal` : l'histogramme doit être nettement bimodal.
S'il ne l'est pas, la zone ne tombe pas sur le timer et il faut passer un
`hudZone` adapté plutôt que toucher aux seuils.
