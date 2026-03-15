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

#### 1. Infrastructure Monorepo Nx
- [x] Initialisation Nx v22.5.4
- [x] Structure `/apps` pour projets multiples
- [x] Configuration TypeScript partagée
- [x] Scripts de build et de test

#### 2. Cœur Backend NestJS
- [x] Génération application NestJS via Nx
- [x] Configuration module de base
- [x] Intégration dans l'écosystème Nx

#### 3. Architecture Clean
- [x] Création dossier `domain/` (entités métier pures)
- [x] Création dossier `application/` (use cases)
- [x] Création dossier `infrastructure/` (implémentations techniques)
- [x] Séparation des responsabilités respectée

#### 4. Base de Données Prisma
- [x] Installation Prisma v7.5.0
- [x] Schéma complet défini :
  - `Tournament` (tournois)
  - `Player` (joueurs)
  - `Set` (matchs)
  - `Vod` (vidéos)
- [x] Relations correctes entre entités
- [x] Configuration isolée dans `apps/backend/`
- [x] Client Prisma généré

#### 5. Services d'Infrastructure
- [x] `PrismaService` configuré avec connexion automatique
- [x] `TournamentRepository` implémenté (pattern Repository)
- [x] Import/export corrects entre couches

#### 6. Configuration Docker
- [x] `docker-compose.yml` avec PostgreSQL et Redis
- [x] Variables d'environnement configurées
- [x] Structure prête pour développement local

#### 7. Qualité & Standards
- [x] ESLint configuré
- [x] Prettier configuré
- [x] EditorConfig pour cohérence équipe
- [x] Tests Jest configurés
- [x] TypeScript strict

### 📊 Progression Phase 1
**État actuel : 100% TERMINÉE ✅**
**Date de fin :** 15/03/2026
**Backend démarré sur :** http://localhost:3000/api

### ⏳ Actions en Attente
**Aucune - Phase 1 terminée !**

---

## 🎯 Phase 2 : Intégration Start.gg (Prochaine)

### Objectif
Récupérer les données des tournois Smash depuis l'API GraphQL de Start.gg.

### Actions Prévues
1. **Module Start.gg Infrastructure**
   - Client GraphQL configuré
   - Gestion tokens API
   - Rate limiting

2. **Interfaces Domain**
   - `ITournamentRepository` (déjà fait)
   - `IStartGGService`
   - `ITournamentService`

3. **Services Application**
   - `TournamentUseCase`
   - `PlayerUseCase`
   - `SetUseCase`

4. **Tests Unitaires**
   - Mock repositories
   - Validation use cases

---

## 🔄 Phase 3 : Video Processing (Futur)

### Objectif
Découper automatiquement les VODs de 10h en matchs individuels.

### Actions Prévues
1. **Queue Management**
   - Configuration BullMQ
   - Workers Redis
   - Gestion erreurs

2. **Video Processing**
   - Service FFmpeg
   - Découpage par timestamps
   - Gestion métadonnées

3. **Computer Vision**
   - Service OpenCV
   - Détection scènes de fin de match
   - Validation automatique

---

## 📱 Phase 4 : Frontend Dashboard (Futur)

### Objectif
Interface Angular pour suivre l'avancement et gérer les traitements.

### Actions Prévues
1. **Application Angular**
   - Génération via Nx
   - Modules par feature
   - Routing lazy-loading

2. **Consommation API**
   - Services HTTP
   - Gestion erreurs
   - Real-time updates

3. **UI/UX**
   - Tableaux de bord
   - Suivi traitements
   - Notifications

---

## 📈 Métriques & KPIs

### Techniques
- [x] Architecture Clean respectée
- [x] TypeScript strict
- [x] Tests configurés
- [ ] Couverture tests > 80%
- [ ] Documentation API

### Fonctionnelles
- [ ] Récupération tournois Start.gg
- [ ] Découpage automatique VODs
- [ ] Dashboard utilisateur
- [ ] Déploiement production

---

## 🔄 Mise à Jour

*Ce document est mis à jour à chaque étape majeure du projet pour garder une vision claire de l'avancement.*

**Dernière mise à jour :** 15/03/2026 - Phase 1 à 90%
