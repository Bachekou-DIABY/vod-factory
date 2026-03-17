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

## 🔄 Phase 3 : Video Management & VODs (VOD Ingestion) ✅

### Objectif
Lier des sources vidéo aux tournois et préparer le découpage.

### ✅ Actions Réalisées
1. **Gestion des VODs**
   - [x] Création du `VodRepository`
   - [x] Use Case : `AddVodToTournament`
   - [x] Validation des URLs (YouTube/Twitch)

2. **Système de Files (Background Jobs)**
   - [x] Configuration de BullMQ avec Redis
   - [x] Création du `VideoProcessingWorker` (Moteur de queue)

### 📊 Progression Phase 3
**État actuel : 100% TERMINÉE ✅**

---

## 🏗️ Phase 4 : Video Processing & OpenCV (Actuelle) 🏃‍♂️

### Objectif
Le "cœur nucléaire" : découpage automatique.

### Actions Prévues
1. **FFmpeg Integration**
   - [ ] Service de manipulation vidéo
   - [ ] Téléchargement segmenté des flux
   - [ ] Découpage par segments

2. **Computer Vision**
   - [ ] Service OpenCV pour détecter les écrans de victoire
   - [ ] Synchronisation match <-> segment vidéo (Indexation temporelle)
