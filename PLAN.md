# 🚀 VOD-Factory - Plan de Développement

## 📋 Contexte Projet

**VOD-Factory** est une plateforme SaaS d'indexation et de découpage automatisé de VODs e-sport avec focus sur Super Smash Bros. Ultimate.

- **Stack Technique** : Monorepo Nx, NestJS (Back), Angular (Front), Prisma (PostgreSQL), BullMQ (Redis), FFmpeg + Tesseract.js (Processing)
- **Architecture** : Clean Architecture / Architecture Hexagonale
- **Profil** : Développeur Fullstack Senior spécialisé Backend/Node.js

---

## 🏗️ Phase 1 : Socle Technique & Data Persistence ✅

### Objectif
Établir les fondations techniques et permettre au backend de communiquer avec la base de données.

### ✅ Actions Réalisées

#### 1. Infrastructure & Qualité
- [x] Initialisation Nx v22.5.4
- [x] Structure `/apps` pour projets multiples
- [x] CI/CD GitHub Actions (Lint/Test/Build)
- [x] TDD sur les Use Cases

#### 2. Cœur Backend & Architecture
- [x] NestJS configuré avec Clean Architecture
- [x] Séparation stricte : `domain/`, `application/`, `infrastructure/`
- [x] Inversion de Dépendance (DIP) via tokens NestJS
- [x] Mappers de données (isolation Prisma ↔ Domaine)

#### 3. Base de Données Prisma
- [x] PostgreSQL via Docker
- [x] Schéma : `Tournament`, `Player`, `Set`, `Vod`
- [x] Client Prisma configuré pour Nx monorepo

### 📊 Progression Phase 1 : **100% ✅**

---

## 🎯 Phase 2 : Intégration Start.gg ✅

### Objectif
Récupérer les données des tournois depuis l'API GraphQL de Start.gg.

### ✅ Actions Réalisées
- [x] `IStartGGService` + `StartGGService` (GraphQL via Axios)
- [x] Filtres par jeux (Ultimate, Melee, etc.)
- [x] `ImportTournamentUseCase` + `ImportSetsUseCase`
- [x] Tests unitaires TDD

### ⚠️ Limitation connue
- `getSetsByEventId` paginé à 50/page sans boucle → sets tronqués si > 50 par event (à corriger en Phase 5)

### 📊 Progression Phase 2 : **100% ✅** (fonctionnel, limitation pagination connue)

---

## 🔄 Phase 3 : Video Management & VODs ✅

### Objectif
Lier des sources vidéo aux tournois et télécharger les VODs.

### ✅ Actions Réalisées
- [x] `Vod` entity dans le domaine (`filePath`, `status`, métadonnées Twitch/YouTube)
- [x] `VodRepository` avec Prisma
- [x] `YtDlpDownloadService` : téléchargement réel via `yt-dlp`
- [x] `AddVodToTournamentUseCase` + `GetTournamentVodsUseCase`
- [x] `VodController` : `POST /api/vods`, `GET /api/vods/:id`
- [x] Templates croppés générés dans `storage/templates/cropped/`

### ⚠️ Limitation connue
- `duration: 0` hardcodé dans `YtDlpDownloadService` (ffprobe à intégrer en Phase 5)

### 📊 Progression Phase 3 : **100% ✅**

---

## 🏗️ Phase 4 : Video Processing & OCR Detection 🚧

### Objectif
Le "cœur nucléaire" : découpage automatique via OCR (pas de Template Matching).

### Stratégie : OCR + Zone Centrale
1. **Croper la zone centrale** (30%) où apparaissent "GO", "PARTEZ", "GAME", "FINI"
2. **OCR avec Tesseract.js** : lire le texte, pas comparer les pixels
3. **Mots-clés multilingues** : go/partez/start/begin + game/fini/end/finish/set

### ✅ Actions Réalisées
- [x] `IGameScreenDetector` interface propre
- [x] `OcrGameScreenDetector` : pipeline complet FFmpeg → OCR → events
- [x] `AnalyzeVodUseCase` : logique de comptage des games (`countGames`)
- [x] `POST /api/vods/:id/analyze` endpoint dans `VodController`
- [x] `tesseract.js` + `fluent-ffmpeg` installés
- [x] Extraction frames 1fps avec crop zone centrale 30%
- [x] Déduplication événements (fenêtre 5 secondes)
- [x] Cleanup automatique des frames temporaires

### 🚧 À faire
- [ ] Tester sur une VOD réelle et affiner les seuils OCR si besoin

### 📊 Progression Phase 4 : **80%** (pipeline complet, validation terrain restante)

---

## 🎯 Phase 5 : Découpage & Export (Futur)

- [ ] Découpage sans ré-encodage (`ffmpeg -c copy`)
- [ ] Association Set ↔ Segment vidéo (modèle `VideoSegment` à créer)
- [ ] Upload vers S3/Cloud Storage
- [ ] Corriger pagination Start.gg (> 50 sets/event)

---

## 🔒 Sécurité

- [x] `.env` retiré du tracking git + `.gitignore` mis à jour
- [x] Token Start.gg révoqué et remplacé

---

## 🛠️ Stack Technique

| Couche | Technologie |
|--------|-------------|
| Monorepo | Nx 22.5.4 |
| Backend | NestJS 11, TypeScript 5.9 |
| Base de données | PostgreSQL 15, Prisma 5.22 |
| Cache/Jobs | Redis (Docker OK, BullMQ pas encore intégré) |
| OCR | Tesseract.js 5.x |
| Video | fluent-ffmpeg 2.x |
| Download | yt-dlp (CLI externe) |

---

## 📝 Historique

**18/03/2026** :
- Rollback Template Matching → OCR pure avec Tesseract.js
- Fix Prisma Client output pour Nx monorepo
- Templates de référence générés (usage : calibration OCR, pas template matching)

**19/03/2026** :
- Audit complet du codebase, réalignement du plan sur l'état réel
- Fix `filePath` : migration Prisma + mapper + interface `download()` optional
- Fix route collision `/:id/vods` dans `TournamentVodsController`
- Implémentation pipeline OCR complet : FFmpeg frames → Tesseract → déduplication
- Suppression code mort `calibrateWithTemplates()` (vestige Template Matching)
- Sécurité : `.env` retiré du git, token révoqué
