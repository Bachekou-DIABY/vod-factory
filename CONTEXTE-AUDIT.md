# VOD-Factory — brief pour audit externe

> À coller dans une conversation neuve. Le modèle n'a pas accès au dépôt : ce
> document doit se suffire à lui-même. Les chemins sont donnés pour que tu
> puisses demander un fichier précis si besoin.

---

## Ce que j'attends de toi

Un **état des lieux** puis un **plan d'amélioration priorisé**. Pas de code,
sauf si un extrait vaut mieux qu'un paragraphe. Je veux :

1. Ce qui cloche dans l'architecture ou les choix techniques, par ordre de gravité.
2. Ce qui va casser en production et que je n'ai pas vu venir.
3. Le plan d'amélioration, ordonné par rapport valeur sur effort, avec pour
   chaque point ce que ça coûte et ce que ça rapporte.
4. Ce que tu ferais différemment sur le pipeline de détection, qui est le cœur
   du produit et la partie la moins mûre.

Dis-moi explicitement si un choix te paraît bon, je veux éviter de réécrire ce
qui marche. Et signale les fichiers que tu voudrais lire pour trancher.

---

## Le produit

Automatiser l'archivage des VODs de tournois Super Smash Bros. Ultimate pour
les organisateurs de tournois. On donne l'URL d'une VOD Twitch et l'identifiant
de l'event Start.gg, l'outil télécharge le stream, découpe un clip par set, et
l'uploade sur YouTube avec titre, description, miniature et playlist.

Utilisateur type : un organisateur bénévole qui stream une journée de tournoi de
huit à douze heures et veut publier quarante clips sans les découper à la main.

Développeur : une personne, en parallèle d'un travail. Le budget d'hébergement
est zéro, d'où la cible Oracle Cloud Always Free.

---

## Stack et architecture

| Couche | Choix |
|---|---|
| Monorepo | Nx 22 |
| Backend | NestJS 11, TypeScript |
| Frontend | Angular 21, Tailwind |
| Base | PostgreSQL 15, Prisma 5 |
| Files | Redis, BullMQ |
| Vidéo | FFmpeg, yt-dlp |
| YouTube | googleapis, OAuth2, Data API v3 |
| OCR | tesseract.js, Jimp |

Architecture hexagonale dans `apps/backend/src/` :

```
domain/          entités, interfaces de repositories, tokens d'injection
application/     use cases, logique pure d'alignement
infrastructure/  http (controllers), persistence (Prisma), queues (BullMQ),
                 external-services (FFmpeg, yt-dlp, Start.gg, YouTube, OCR)
```

Les use cases dépendent d'interfaces du domaine, l'injection se fait par tokens
Nest. Les repositories Prisma passent par des mappers.

---

## Le problème central

Découper une VOD de dix heures en un clip par set. Deux sources d'information,
toutes deux imparfaites.

**Start.gg** donne la liste ordonnée des sets passés on-stream, avec pour chacun
`startedAt`, `completedAt`, `displayScore` et `totalGames`. Le problème : les
organisateurs lancent et reportent les sets à la main, donc les timestamps sont
bruités, parfois de plusieurs minutes, parfois absents.

**La vidéo** donne des frontières précises mais produit des faux positifs :
écrans de bracket, replays, caméra plateau, friendlies hors bracket.

Aucune des deux ne suffit seule.

---

## Trois voies de découpage coexistent

C'est un point d'architecture sur lequel j'aimerais ton avis : est-ce que
garder les trois est raisonnable, ou faut-il en supprimer.

**Voie 1, timestamps seuls.** `generate-clips-from-timestamps.usecase.ts`.
On convertit `startedAt` et `completedAt` en secondes dans la VOD via
`vod.recordedAt`, avec un pré-roll de 60s et un post-roll de 30s. Simple,
aucune analyse vidéo, mais la précision dépend entièrement du sérieux du TO.

**Voie 2, détection HUD seule.** `ocr-game-screen-detector.service.ts` plus
`analyze-vod.usecase.ts`. La VOD est découpée en chunks d'une heure avec 60s de
recouvrement, chaque chunk part dans un job BullMQ. Pour chaque seconde de
vidéo : extraction d'une frame JPEG sur disque, lecture par Jimp, mesure du
pourcentage de pixels blancs dans une zone du HUD, et si ça dépasse un seuil,
validation par Tesseract que le timer se lit au format `M:SS`. Un automate à
états produit des événements START et END avec des constantes réglées à la
main : durée minimale de game, cooldown après un END, nombre de frames
consécutives sans HUD pour conclure à une fin, fenêtre de recherche du fondu au
noir précédent.

C'est lent et fragile. C'est ce qui a motivé la voie 3.

**Voie 3, alignement, écrite récemment.** Détaillée ci-dessous. C'est la partie
sur laquelle je veux le plus de retour.

---

## La voie 3 en détail

Idée : Start.gg fournit la **structure**, la vidéo fournit les **frontières**.
Un set noté 3-1 contient exactement quatre games. Cette contrainte transforme un
problème de détection ouvert en un problème d'alignement contraint.

**Étape 1, signal.** `infrastructure/external-services/frame-signal.service.ts`.
Une seule passe FFmpeg sur toute la VOD. Les frames sont réduites à 320x180 en
niveaux de gris par FFmpeg lui-même et streamées en rawvideo sur stdout, donc
rien ne touche le disque. Pour chaque seconde on calcule deux scalaires
quantifiés sur un octet : densité de pixels clairs dans la zone HUD, densité de
pixels sombres sur toute la frame. Décodage keyframe-only par défaut via
`-skip_frame nokey`, ce qui divise le coût par environ dix sur une VOD Twitch,
au prix d'une précision temporelle de l'ordre de la seconde.

**Étape 2, segmentation.** `application/alignment/segmenter.ts`. Fonctions
pures. Filtre médian sur le signal HUD, puis seuillage à hystérésis avec un
seuil d'entrée et un seuil de sortie plus bas. Fusion des intervalles séparés
par moins de douze secondes, ce qui absorbe les kill screens. Rejet des
intervalles de moins de quarante-cinq secondes. Recalage du début de chaque
intervalle sur le début du fondu au noir qui le précède, pour attraper le
décompte et l'intro de stage. Volontairement permissif : les faux positifs sont
éliminés plus tard.

**Étape 3, biais.** `application/alignment/offset-estimator.ts`. L'erreur des
organisateurs n'est pas aléatoire, elle est systématique : celui qui lance en
retard le fait tout le tournoi. On construit deux masques booléens à la seconde,
l'un des intervalles détectés, l'autre des sets attendus d'après l'API, et on
cherche par corrélation croisée le décalage qui maximise le recouvrement, sur
plus ou moins quinze minutes. On renvoie le décalage et une confiance combinant
couverture et netteté du pic.

**Étape 4, alignement.** `application/alignment/set-aligner.ts`. Programmation
dynamique monotone façon Needleman-Wunsch. `dp[i][j]` est le coût minimal après
avoir placé les sets 1 à i en consommant les candidats 1 à j. Chaque set
consomme un segment contigu de candidats, longueur nulle à sept. Les candidats
non attribués sont des orphelins et coûtent une pénalité fixe. Le coût
d'attribution combine : écart au nombre de games annoncé par le score, écart
aux timestamps API recalés par le biais et plafonné, pénalité sur les trous
anormaux entre deux games d'un même set. `completedAt` est pondéré moitié moins
que `startedAt`, parce que le score est reporté après coup et donc plus bruité.
Un set gagné par forfait attend zéro game. Backtracking pour récupérer
l'affectation.

**Étape 5, rattrapage.** Là où le score annonce plus de games que détecté, on
re-segmente la fenêtre avec des seuils plus bas. Le signal quantifié est
conservé en base, donc c'est gratuit et sans redécodage. Puis on relance
l'alignement complet avec les candidats supplémentaires.

**Étape 6, validation OCR.** `timer-ocr-validator.service.ts`. L'OCR ne détecte
plus, il confirme : trois frames pleine résolution par game candidate, et on
vérifie que le timer se lit. Quelques centaines d'appels Tesseract au lieu d'un
par seconde de VOD. Un échec rétrograde la confiance au lieu d'écarter.

**Sortie.** Un `AlignmentReport` persisté en JSON sur la VOD, avec pour chaque
set les bornes, la source (`video`, `video-partial`, `api`), une confiance et
des avertissements. `generate-clips-from-alignment.usecase.ts` génère ensuite
les clips en écartant ceux sous un seuil de confiance, pour revue manuelle.

Endpoints : `POST /vods/:id/align`, `GET /vods/:id/alignment`,
`POST /vods/:id/clips-from-alignment`, et `GET /vods/:id/alignment/signal` qui
renvoie le signal sous-échantillonné et un histogramme, pour régler les seuils.

Seize tests unitaires couvrent le parsing de score, l'alignement, le rejet de
faux positifs, le forfait, le repli sur l'API et l'estimation du biais.

---

## Modèle de données

`Tournament` a des `Set`, chacun avec deux `Player`, un `roundName`, un `score`,
`startTime` et `endTime`. Une `Vod` porte `sourceUrl`, `filePath`, `duration`,
`recordedAt`, un `status` énuméré, et pour l'alignement `alignment` en JSON plus
`hudSignal` en binaire et `signalSampleRate`. Une `Vod` a des `Clip`, chacun
avec `startSeconds`, `endSeconds`, titre, description, miniature,
`youtubeVideoId` et un `status` de revue.

Trois files BullMQ : `vod-download`, `vod-processing` pour l'ancienne analyse par
chunks, `clip-set` pour le découpage, `vod-align` pour l'alignement.

---

## Dette connue et non-fait

- La **zone HUD est en dur** dans une constante, en fractions de la frame.
  L'overlay de chaque organisateur est différent. Pas d'auto-calibration.
- **Pas de détecteur audio.** Smash a des marqueurs sonores très distinctifs,
  décompte, "GO!", sting de fin, sons de KO. Ce serait un signal indépendant de
  l'image, robuste aux overlays. Identifié, pas écrit.
- **L'automate de la voie 2 est un HMM artisanal.** Un Viterbi sur des classes
  d'écran serait plus propre. Identifié, pas écrit.
- **Pas d'interface front pour l'alignement.** Seulement les endpoints.
- **Les seuils de segmentation ne sont validés sur aucune vraie VOD.** Ils sont
  dérivés des constantes de l'ancien détecteur.
- **Le chat Twitch n'est pas exploité.** Le débit de messages explose aux KO et
  aux fins de set, et les "GG" marquent les fins de set. Signal indépendant,
  récupérable, non utilisé.
- **Renouvellement Let's Encrypt cassé par construction.** `certbot renew` en
  mode standalone alors que le port 80 sera pris par le conteneur nginx. Se
  manifestera quatre-vingt-dix jours après la mise en ligne.
- **Beaucoup de `as any`** pour contourner le décalage entre les types Prisma
  générés et le schéma.
- **Pas de tests d'intégration** sur les use cases, seulement de l'unitaire sur
  la logique pure et deux specs plus anciennes.
- **Aucune observabilité.** Des logs Nest, rien d'autre.

---

## Contraintes

- **Hébergement cible :** une instance Oracle Cloud Always Free, Ampere ARM64,
  2 OCPU et 12 Go de RAM au mieux, éventuellement 1 OCPU et 6 Go si la capacité
  manque. Tout tourne dessus : Postgres, Redis, le backend, le frontend, FFmpeg
  et yt-dlp.
- **Disque :** 200 Go de block storage pour tout le compte, dont 47 déjà pris.
  Une VOD Twitch de huit heures en 1080p60 pèse dix à quinze gigaoctets.
- **Budget :** zéro. Toute proposition impliquant un service payant doit le dire
  franchement et chiffrer.
- **Une seule personne** développe, en temps partiel. Un plan qui demande trois
  mois-homme n'est pas actionnable.
- **Pas de GPU.** Toute idée de modèle de vision doit tourner sur CPU ARM, ou
  être justifiée autrement.
- Les clips partent sur YouTube, donc le respect des conditions d'utilisation de
  l'API compte.

---

## Questions ouvertes sur lesquelles je veux ton avis

1. Garder les trois voies de découpage, ou n'en garder qu'une ?
2. L'alignement par programmation dynamique est-il la bonne formulation, ou
   est-ce que je me complique la vie ?
3. Le stockage du signal quantifié en base est-il une bonne idée, ou faut-il le
   sortir dans un fichier ?
4. Par quoi commencer pour rendre la détection fiable sur de vraies VODs ?
5. Quelque chose de structurellement bancal que je n'ai pas listé ?
