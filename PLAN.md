# 🚀 VOD-Factory - Plan de Développement

## 📋 Contexte Projet

**VOD-Factory** est une plateforme SaaS d'indexation et de découpage automatisé de VODs e-sport avec focus sur Super Smash Bros. Ultimate.

- **Stack Technique** : Monorepo Nx, NestJS (Back), Angular (Front), Prisma (PostgreSQL), BullMQ (Redis), FFmpeg + OpenCV (Processing)
- **Architecture** : Clean Architecture / Architecture Hexagonale
- **Profil** : Développeur Fullstack Senior spécialisé Backend/Node.js

---

## 🏗️ Phase 1 : Socle Technique & Data Persistence ✅

### Objectif
Établir les fondations techniques et permettre au backend de communiquer avec la base de données.

### ✅ Actions Réalisées

#### 1. Infrastructure & Qualité (Senior Level)
- [x] Initialisation Nx v22.5.4
- [x] Structure `/apps` pour projets multiples
- [x] **CI/CD activée** : GitHub Actions pour Lint/Test/Build automatique
- [x] TDD (Test Driven Development) mis en place sur les Use Cases

#### 2. Cœur Backend & Architecture
- [x] NestJS configuré avec Clean Architecture
- [x] Séparation stricte : `domain/`, `application/`, `infrastructure/`
- [x] **Inversion de Dépendance (DIP)** : Utilisation de tokens DI pour découpler les couches
- [x] **Mappers de Données** : Isolation totale entre Prisma et le Domaine métier

#### 3. Base de Données Prisma
- [x] PostgreSQL via Docker
- [x] Schéma complet : `Tournament`, `Player`, `Set`, `Vod`
- [x] Client Prisma généré et utilisé via des Repositories

### 📊 Progression Phase 1
**État actuel : 100% TERMINÉE ✅**

---

## 🎯 Phase 2 : Intégration Start.gg ✅

### Objectif
Récupérer les données des tournois depuis l'API GraphQL de Start.gg.

### ✅ Actions Réalisées
- [x] **IStartGGService** : Interface définie dans le domaine
- [x] **StartGGService** : Implémentation réelle avec GraphQL (Axios + graphql-tag)
- [x] **Gestion de la Complexité** : Récupération par événements pour éviter les timeouts API
- [x] **Filtres Intelligents** : Importation ciblée sur les jeux populaires (Ultimate, Melee, etc.)
- [x] **ImportTournamentUseCase** : Création/Récupération de tournois automatiques
- [x] **ImportSetsUseCase** : Importation massive de matchs et création automatique des joueurs

### 📊 Progression Phase 2
**État actuel : 100% TERMINÉE ✅**

---

## 🔄 Phase 3 : Video Management & VODs (Actuelle) 🏃‍♂️

### Objectif
Lier des sources vidéo aux tournois et préparer le découpage.

### ✅ Actions Réalisées
1. **Gestion des VODs**
   - [x] Schéma Prisma Vod avec métadonnées Twitch/YouTube
   - [x] **Fix Prisma Client** : Configuration du `output` pour Nx monorepo
   - [x] Prisma Service avec logs améliorés

2. **Templates de Référence** ✅
   - [x] Génération des templates croppés dans `storage/templates/cropped/`
   - [x] 4 templates : `start_go`, `start_partez`, `end_game`, `end_fini`
   - [x] Zone centrale isolée (30%) pour OCR

### 📊 Progression Phase 3
**État actuel : 95% TERMINÉE ✅** (Prisma stable, templates prêts)

---

## 🏗️ Phase 4 : Video Processing & OCR Detection (En Cours) 🚧

### Objectif
Le "cœur nucléaire" : découpage automatique via OCR (pas de Template Matching).

### Stratégie "Senior" : Focus OCR + Zone Centrale
Au lieu de comparer des images entières (fragile aux changements de map), on :
1. **Crope la zone centrale** (30% de l'image) où apparaissent "GO", "PARTEZ", "GAME", "FINI"
2. **OCR avec Tesseract.js** : On "lit" le texte, on ne compare pas les pixels
3. **Mots-clés multilingues** : go/partez/start/begin + game/fini/end/finish/set

### ✅ Actions Réalisées
1. **Architecture OCR**
   - [x] `IGameScreenDetector` interface (domaine)
   - [x] `OcrGameScreenDetector` service avec Tesseract.js
   - [x] Mots-clés de détection configurés
   - [x] Seuil de confiance : 70%

2. **Use Case Analyse**
   - [x] `AnalyzeVodUseCase` créé
   - [x] Logique de comptage des games (pairs START/END)

### 🚧 Actions en Cours
3. **HTTP Layer**
   - [ ] `VodController` avec endpoint `POST /api/vods/:id/analyze`
   - [ ] DTOs pour la requête/réponse
   - [ ] Configuration des providers NestJS

4. **Video Processing**
   - [ ] Intégration FFmpeg pour extraction frames
   - [ ] 1 frame/sec pour analyse rapide
   - [ ] Pipeline : Download → OCR → Timestamps → Découpage

### 📊 Progression Phase 4
**État actuel : 40% - Architecture OCR en place, manque l'intégration FFmpeg/HTTP**

---

## 🎯 Prochaines Étapes Prioritaires

### 1. Terminer Phase 4 (OCR) 🚧
- [ ] Créer `VodController` avec endpoint analyze
- [ ] Configurer le module avec les providers
- [ ] Intégrer FFmpeg pour extraction vidéo
- [ ] Tester sur une VOD réelle

### 2. Phase 5 : Découpage & Export (Futur)
- [ ] Découpage sans ré-encodage (`ffmpeg -c copy`)
- [ ] Upload vers S3/Cloud Storage
- [ ] Association Set ↔ Segment vidéo

---

## 🛠️ Stack Technique Détaillée

| Couche | Technologie |
|--------|-------------|
| Monorepo | Nx 22.5.4 |
| Backend | NestJS 11, TypeScript 5.9 |
| Base de données | PostgreSQL 15, Prisma 5.22 |
| Cache/Jobs | Redis, BullMQ |
| OCR | Tesseract.js 5.x |
| Video | FFmpeg (à intégrer) |
| Templates | Jimp (génération cropped) |

---

## 📝 Notes & Apprentissages

**18/03/2026** :
- Rollback réussi après approche Template Matching trop fragile
- Migration vers OCR pure avec Tesseract.js
- Fix Prisma Client output pour Nx monorepo
- Templates de référence générés et stockés dans `storage/templates/cropped/`
