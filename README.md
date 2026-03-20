# 🎬 VOD-Factory

> Plateforme SaaS d'**indexation** et de **découpage automatisé** de VODs e-sport  
> Focus initial : **Super Smash Bros. Ultimate** / Start.gg

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

## 🎯 Vision

L'objectif : à partir des données Start.gg d'un tournoi, 
extraire et exporter automatiquement les sets individuels depuis une VOD.

Deux modes de fonctionnement :
- **Mode automatique** — Start.gg bien configuré avec les timestamps → découpage et upload sans intervention
- **Mode manuel** — l'utilisateur fournit la VOD + le tournoi → le soft s'occupe du découpage et de l'upload sur la chaîne YouTube (accès restreint aux ayants droit)
  
## 🛠️ Stack

| Couche | Technologie |
|---|---|
| Monorepo | Nx |
| Backend | NestJS (TypeScript) |
| Base de données | PostgreSQL (Prisma) |
| Queue | Redis + BullMQ (Phase 3) |
| Traitement vidéo | FFmpeg + OpenCV (Phase 3) |
| Auth | OAuth2 Google/YouTube |

## 🚀 Démarrage rapide

### Prérequis
- Node.js 20+
- Docker Desktop

### Installation
```bash
npm install
npm run docker:up
```

Variables d'environnement (`.env`) :
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vod_factory
```
```bash
npm run prisma:generate
npm run prisma:push
npm run dev
```

API disponible sur `http://localhost:3000/api`

## 📁 Architecture
```
apps/
  backend/
    prisma/           # Schéma Prisma (source de vérité)
    src/
      domain/         # Entités + interfaces (Clean Architecture)
      application/    # Use cases
      infrastructure/ # Adapters techniques
  backend-e2e/        # Tests e2e
```

## 🗺️ Roadmap

- ✅ **Phase 1** — Socle Nx/NestJS + Prisma + Docker
- ✅ **Phase 2** — Intégration Start.gg (GraphQL)
- ✅ **Phase 3** — Pipeline vidéo : download (yt-dlp), détection games (HUD timer OCR), clipping (FFmpeg)
- 🔄 **Phase 4** — Robustesse & scale : tests VODs longues (10h+), workers BullMQ parallèles, upload YouTube
- ⏳ **Phase 5** — Dashboard frontend Angular

## 🎬 Pipeline VOD (Phase 3)

```
POST /api/vods              → Enregistre une VOD (URL + setId)
POST /api/vods/:id/analyze  → Détecte les games via présence du HUD timer (1fps, zone top-right)
POST /api/vods/:id/clip     → Génère le clip (firstSTART-15s → lastEND+15s) avec FFmpeg -c copy
```

**Détection SSBU** — state machine sur le % de pixels blancs dans la zone timer :
- `timerVisibleThreshold = 3%` — HUD présent = game en cours
- `minGameDurationSeconds = 90` — filtre les faux positifs courts
- `cooldownAfterEndSeconds = 25` — évite les faux STARTs sur l'écran résultats
- `consecutiveTimerAbsent >= 3` — ignore les kill screens (~1-2s)

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Lance l'API en dev |
| `npm run docker:up` | Démarre Postgres + Redis |
| `npm run prisma:studio` | Interface visuelle BDD |
| `npm run test` | Lance les tests |
