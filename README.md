# VOD-Factory

Plateforme de découpage automatisé de VODs e-sport.
À partir des données Start.gg d'un tournoi, découpe et uploade automatiquement chaque set sur YouTube.

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

## Prérequis

- Node.js 20+
- Docker Desktop
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installé et dans le PATH
- [FFmpeg](https://ffmpeg.org/) installé et dans le PATH

---

## Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Démarrer PostgreSQL + Redis
npm run docker:up

# 3. Créer le fichier .env dans apps/backend/
cp apps/backend/.env.example apps/backend/.env
# → renseigner DATABASE_URL, STARTGG_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

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

Les deux doivent tourner en même temps.

---

## Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Lance le backend NestJS |
| `npx nx serve frontend` | Lance le frontend Angular |
| `npm run docker:up` | Démarre PostgreSQL + Redis |
| `npm run docker:down` | Arrête les containers |
| `npm run prisma:migrate` | Applique les migrations (modifs schéma) |
| `npm run prisma:generate` | Régénère le client Prisma |
| `npm run prisma:studio` | Interface visuelle base de données |
| `npm run test` | Lance les tests |

### Consulter les files BullMQ

Une fois le backend lancé, ouvre : **http://localhost:3000/queues**

Interface Bull Board : statut des jobs `vod-processing` et `clip-set` en temps réel.

---

## Configuration YouTube

Pour uploader les clips sur YouTube :

1. Crée un projet sur [Google Cloud Console](https://console.cloud.google.com)
2. Active l'API **YouTube Data API v3**
3. Crée un ID client OAuth 2.0 (Application Web)
   - URI de redirection : `http://localhost:3000/api/youtube/callback`
4. Ajoute dans `apps/backend/.env` :
   ```
   GOOGLE_CLIENT_ID=ton-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=ton-secret
   ```
5. Dans l'app → "Clips approuvés" → bouton **Connecter YouTube**

---

## Pipeline

```
POST /api/vods              → Enregistrer une VOD (URL Twitch/YouTube)
POST /api/vods/upload       → Uploader un fichier vidéo local (multipart)
POST /api/vods/:id/clip     → Générer les clips (1 par set, FFmpeg -c copy, timestamps Start.gg)
POST /api/clips/:id/upload-youtube → Uploader un clip sur YouTube
```

---

## Roadmap

- ✅ Phase 1 — Socle Nx/NestJS + Prisma + Docker
- ✅ Phase 2 — Intégration Start.gg (GraphQL)
- ✅ Phase 3 — Pipeline vidéo : download, détection HUD timer, clipping FFmpeg
- ✅ Phase 4 — Multi-set clipping, BullMQ workers parallèles
- ✅ Phase 5 — Frontend Angular, clip-review UI, upload YouTube OAuth2
- ⏳ Suite — pagination Start.gg > 50 sets, ffprobe, suppression VOD source
