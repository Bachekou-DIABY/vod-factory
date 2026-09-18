# Déploiement Oracle Cloud — état et reprise

Notes prises le 11 septembre 2026, mises à jour le 18 septembre.

**Où on en est :** déployé et en ligne sur https://vod.bdiaby.fr, en HTTPS,
frontend et API répondent. Le compte est en Pay As You Go.

---

## Reprendre ici

La machine est accessible par `ssh vod-factory`. Le dépôt est cloné dans
`~/vod-factory`.

```bash
cd ~/vod-factory
docker compose -f docker-compose.production.yml --env-file .env.production ps
./deploy.sh              # redémarre sans reconstruire
./deploy.sh --build      # reconstruit avec le cache Docker, quelques minutes
./deploy.sh --rebuild    # reconstruction complète sans cache, ~20 min
```

| Élément | Valeur |
|---|---|
| Instance | `vod-factory`, VM.Standard.A1.Flex, 2 OCPU / 12 Go |
| IP publique | `130.110.250.226`, **réservée** |
| Boot volume | 150 Go |
| Domaine | `vod.bdiaby.fr`, HTTPS actif |
| Utilisateur SSH | `ubuntu` |
| Espace disque | 145 Go utilisables, 8 % occupés |
| Mémoire | 11 Go, 1 Go utilisé au repos |

Le script `scripts/oci-launch-retry.sh` n'a plus lieu d'être lancé. Il reste
utile si l'instance devait être recréée un jour.

Test d'authentification, doit répondre en quelques secondes :

```bash
~/.oci-cli-venv/Scripts/oci.exe iam region list --output table
```

Un `401 NotAuthenticated` signifie que la clé publique n'est pas enregistrée
dans la console, ou que l'empreinte affichée là-bas ne correspond pas à celle
ci-dessus. Console, icône de profil, My profile, API keys.

### Récupérer les clés publiques

Il y en a deux, à ne pas confondre.

**Clé API**, à coller dans la console : My profile, API keys, Add API key,
Paste a public key. C'est elle qui autorise la CLI et le script.

```powershell
# PowerShell
Get-Content "$env:USERPROFILE\.oci\oci_api_key_public.pem" | Set-Clipboard
```

```bash
# Git Bash
cat ~/.oci/oci_api_key_public.pem | clip
```

Après collage, la console doit afficher l'empreinte
`4f:30:1a:a0:6b:44:6f:6f:18:31:05:2a:2b:12:9b:d1`.

**Clé SSH**, pour se connecter à l'instance. Le script l'injecte tout seul à la
création, il n'y a rien à coller. Utile seulement pour une création manuelle
depuis la console.

```powershell
# PowerShell
Get-Content "$env:USERPROFILE\Downloads\Oracle Cloud\ssh-key-2026-03-16.key.pub" | Set-Clipboard
```

```bash
# Git Bash
cat "/c/Users/bacdi/Downloads/Oracle Cloud/ssh-key-2026-03-16.key.pub" | clip
```

---

## Quotas : les chiffres à ne pas rechercher

Le tier Always Free a été divisé par deux le 15 juin 2026, sans annonce.

| Ressource | Plafond |
|---|---|
| Ampere A1 | 2 OCPU et 12 Go |
| AMD micro | 2 instances de 1/8 OCPU et 1 Go |
| Block storage, tout le tenancy | 200 Go |
| Egress | 10 To par mois |

Un boot volume ne se réduit jamais, il ne fait que grandir, et son plancher est
d'environ 47 Go. Le portfolio en consomme 47, il reste donc **153 Go** pour
vod-factory. Le script demande 150 Go par défaut, soit 197 Go sur 200 au total :
plus aucune marge pour agrandir ou ajouter un volume. `BOOT_VOLUME_GB=90` pour
garder une soixantaine de gigaoctets de réserve.

Consommation actuelle : 47 Go pour la micro et 150 Go pour l'A1, soit **197 Go
sur 200**. Aucune marge, donc aucune sauvegarde de volume ni volume
supplémentaire possible tant que la micro existe.

Depuis le passage en PAYG, un dépassement n'est plus refusé, il est facturé.
C'est le budget qui sert de garde-fou, et il alerte sans bloquer.

Besoin réel estimé, un tournoi à la fois : 50 à 70 Go, entre la VOD source, ses
clips, l'OS, Postgres et les couches Docker accumulées.

---

## Plan de consolidation, plus tard

Héberger le portfolio sur la même instance A1 libère ses 47 Go et permet de
monter le boot volume à environ 195 Go. Le portfolio y gagne un vrai CPU, et on
passe d'un nginx et un certbot par machine à un seul de chaque.

Contrepartie : point de défaillance unique, et la passe de décodage de
l'alignement peut monopoliser les deux cœurs. Limiter le backend dans le
compose règle le second point.

```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '1.5'
```

Ordre impératif, ne rien supprimer avant que l'A1 existe :

1. Décrocher l'instance A1 à 150 Go.
2. Migrer le portfolio dessus, vérifier qu'il répond.
3. Terminer la micro AMD en cochant la suppression de son boot volume.
4. Agrandir le boot volume de l'A1, puis `growpart` et `resize2fs` dans la VM.

---

## Après obtention de l'instance

**Ouvrir les ports aux deux niveaux.** C'est le piège classique. Une seule des
deux étapes ne suffit pas et le symptôme est un timeout silencieux.

Dans le VCN : Networking, la subnet, Security List, deux règles d'entrée depuis
`0.0.0.0/0` en TCP sur les ports 80 et 443.

Dans la VM, les images Ubuntu d'Oracle bloquent tout sauf le 22. **Le numéro
d'insertion compte** : la chaîne INPUT se termine par un `REJECT`, et une règle
ACCEPT placée après lui ne sert à rien. Toujours repérer sa position d'abord.

```bash
sudo iptables -L INPUT -n --line-numbers      # noter la ligne du REJECT
```

Sur l'image Ubuntu 24.04 aarch64 de septembre 2026, le REJECT est en position 5 :

```bash
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 443 -j ACCEPT

---

## État de l'installation

| Élément | État |
|---|---|
| OCI CLI 3.92.1 dans `~/.oci-cli-venv` | fait |
| Config `~/.oci/config`, région `eu-marseille-1` | fait |
| Clé API non chiffrée, empreinte `4f:30:1a:a0:6b:44:6f:6f:18:31:05:2a:2b:12:9b:d1` | fait |
| Clé publique déclarée dans la console | fait |
| Boot volume orphelin de mars supprimé | fait |
| Compte passé en Pay As You Go | fait |
| Budget 5 € avec alertes Actual 20 % et Forecast 100 % | fait |
| Instance A1 créée | fait |
| IP publique réservée et assignée | fait |
| DNS `vod.bdiaby.fr` vers l'IP réservée | fait |
| Ports 80 et 443 ouverts, VCN et iptables | fait |
| Docker installé | fait |
| Certificat Let's Encrypt émis, expire le 16/12/2026 | fait |
| Stack déployée et joignable en HTTPS | fait |
| Hook de renouvellement du certificat | fait, validé en `--dry-run` |
| URL de redirection OAuth déclarée chez Google | fait |
| Connexion YouTube testée en production | fait, chaîne « Bachekou DIABY » |
| FFmpeg 8.0.1 et yt-dlp validés en aarch64 | fait |
| Pipeline d'alignement poussé et déployé | **à faire** |
| Portfolio migré, micro terminée, disque agrandi | **plus tard** |

Le déploiement est terminé. Ce qui reste relève de l'évolution de la
détection, pas de la mise en route. Voir la section « Reprise » en fin de
document.
sudo iptables -L INPUT -n --line-numbers      # REJECT doit être en dernier
```

Persistance, le paquet n'est pas préinstallé :

```bash
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

**IP réservée et DNS : déjà faits.** L'IP `130.110.250.226` est réservée et
assignée, `vod.bdiaby.fr` pointe dessus et la propagation est effective.

**Installer Docker.**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Se déconnecter et se reconnecter pour que le groupe prenne effet.

**Certificat avant la stack.** `nginx.conf` attend les fichiers Let's Encrypt de
`vod.bdiaby.fr` et le compose monte `/etc/letsencrypt` depuis l'hôte. Le
conteneur frontend occupera le port 80, donc le certificat doit être obtenu
avant.

1. `sudo apt install -y certbot` puis `sudo certbot certonly --standalone -d vod.bdiaby.fr`
2. `cp .env.production.example .env.production`, renseigner les valeurs.
3. `./deploy.sh --rebuild` la première fois, une vingtaine de minutes. Ensuite
   `./deploy.sh --build`, qui réutilise le cache Docker et prend quelques minutes.

**Renouvellement du certificat.** `certbot renew` reprend le mode standalone
alors que le port 80 est occupé par le conteneur nginx. Corrigé par deux hooks
dans `/etc/letsencrypt/renewal-hooks/`, qui arrêtent puis relancent le conteneur
`vod-factory-frontend`. Ils vivent hors du dépôt, donc survivent aux
redéploiements. Coût : environ trente secondes de coupure, deux fois par an.

Tester sans consommer de quota Let's Encrypt :

```bash
sudo certbot renew --dry-run
docker ps --filter name=vod-factory-frontend
```

Alternative sans coupure : le mode webroot, qui demande de servir
`/.well-known/acme-challenge` depuis le conteneur. À faire au moment de passer
nginx sur l'hôte pour accueillir le portfolio.

---

## Pièges déjà rencontrés

- **PowerShell n'exécute pas les `.sh`** et rend la main sans message. Utiliser
  Git Bash.
- **`bash` dans le PATH Windows est celui de WSL**, pas Git Bash. Il exécuterait
  le script dans un Linux séparé où `~/.oci` et le venv n'existent pas. Si
  vraiment depuis PowerShell :
  `& "C:\Program Files\Git\bin\bash.exe" ./scripts/oci-launch-retry.sh`
- **L'installateur officiel de l'OCI CLI échoue** sur Python 3.14, faute de
  wheel PyYAML : il tente de compiler et réclame Visual C++. D'où le venv
  Python 3.11 dans `~/.oci-cli-venv`.
- **Une clé API chiffrée bloque tout script non surveillé.** La CLI attend la
  passphrase au clavier. La clé actuelle est volontairement non chiffrée.
- **Une IP éphémère peut être réattribuée à un inconnu.** C'est arrivé le
  17 septembre : l'IP de la micro a changé à un redémarrage, `79.72.28.56` est
  passée à un autre client, et `vod.bdiaby.fr` a continué de pointer dessus.
  Conséquence sous-estimée : une validation Let's Encrypt en HTTP-01 aurait
  réussi depuis cette machine, donc le détenteur pouvait obtenir un certificat
  valide pour le sous-domaine. Toujours réserver l'IP, et ne jamais laisser un
  enregistrement DNS pointer sur une adresse qu'on ne possède plus.
  **La micro est encore sur une IP éphémère : ne pas la redémarrer.**
- **PowerShell 5.1 écrit un BOM UTF-8** avec `-Encoding utf8`, ce qui casse tout
  fichier de configuration Unix. Symptôme côté SSH :
  `Bad configuration option: ï»¿host`. Écrire avec
  `[System.IO.File]::WriteAllText($p, $txt, (New-Object System.Text.UTF8Encoding($false)))`.
- **Une règle iptables insérée après le `REJECT` est inerte.** Symptôme :
  certbot échoue en `Type: connection` sur la validation HTTP-01 alors que le
  DNS est correct et que la Security List du VCN autorise bien le port 80.
  Vérifier avec `iptables -L INPUT -n --line-numbers` que les ACCEPT précèdent
  le REJECT.
- **Un mot de passe en base64 casse `DATABASE_URL`.** `openssl rand -base64`
  produit des `/`, `+` et `=`. Une barre oblique termine l'autorité de l'URL et
  Prisma renvoie `P1013: invalid port number`, message trompeur puisque le port
  est correct. Utiliser `openssl rand -hex 32`. Changer le mot de passe impose
  de supprimer le volume Postgres, déjà initialisé avec l'ancien.
- **`docker compose` ne lit pas `.env.production` tout seul.** Sans
  `--env-file .env.production`, toutes les variables valent la chaîne vide, ce
  qui est inoffensif pour `ps` et `logs` mais destructeur pour `up`. Un lien
  `ln -s .env.production .env` règle le problème une fois pour toutes.
- **Marseille est une région à un seul domaine de disponibilité.** Le conseil
  d'Oracle d'essayer un autre AD ne s'applique pas. Changer de région non plus :
  les ressources Always Free sont limitées à la région de rattachement.

---

## Si la boucle ne donne rien

Le vrai correctif est le passage en **Pay As You Go**. Les comptes gratuits sont
servis en dernier sur la capacité A1, c'est structurel. En PAYG les ressources
Always Free restent gratuites, seul le dépassement est facturé, et les A1 se
créent presque toujours du premier coup.

Deux réserves. Le garde-fou disparaît : sur compte gratuit un dépassement est
refusé, en PAYG il passe et se facture. Et un budget dans Billing & Cost
Management **alerte mais ne bloque pas**, il n'existe pas de plafond dur. Créer
un budget de quelques euros avec alerte à 50 % avant toute chose.

Le passage en PAYG est définitif, et il embarque le portfolio puisque c'est le
même tenancy.

---

## Vérifications de routine

Où pointent réellement les domaines :

```powershell
Resolve-DnsName vod.bdiaby.fr -Type A -Server 1.1.1.1 | Where-Object IPAddress | Select-Object Name,IPAddress
```

Quelles IP je possède et de quel type, et l'état des instances :

```powershell
$env:SUPPRESS_LABEL_WARNING="True"
$oci = "$env:USERPROFILE\.oci-cli-venv\Scripts\oci.exe"
$t = ((Get-Content "$env:USERPROFILE\.oci\config" | Select-String '^tenancy').Line -split '=',2)[1].Trim()
& $oci network public-ip list --compartment-id $t --scope REGION
& $oci compute instance list --compartment-id $t --output table
```

Consommation disque face au quota de 200 Go :

```powershell
$ad = ((& $oci iam availability-domain list --compartment-id $t | ConvertFrom-Json).data)[0].name
(& $oci bv boot-volume list --compartment-id $t --availability-domain $ad | ConvertFrom-Json).data |
  Where-Object { $_.'lifecycle-state' -ne 'TERMINATED' } |
  ForEach-Object { "{0,-34} {1,5} Go" -f $_.'display-name', $_.'size-in-gbs' }
```

---

## Reprise : session du 18 septembre

Le déploiement est terminé et validé. Cette section couvre le travail en cours
sur la détection.

### Ce qui est prouvé

Première analyse réelle lancée sur un extrait de 30 minutes du top 8 SSBU de
l'Ultimate Fighting Arena 2026, stream `Etoiles`, event `1619466`.

| Mesure | Résultat |
|---|---|
| Durée de l'analyse | 30 s pour 30 min de vidéo |
| Sets écartés hors fenêtre | 18 sur 20 |
| Games détectées | 3, pour un set annoncé 3-0 |
| Écart au timestamp Start.gg | 18 s |

**La détection du HUD fonctionne sur cet overlay.** Les trois games trouvées à
845, 1138 et 1393 secondes, de 3 à 4 minutes chacune, séparées de 70 à 90
secondes. Le second set, qui commence après la fin du fichier, a été
correctement signalé en repli plutôt que découpé n'importe comment.

### Validation sur la VOD complète, 18 septembre

Top 8 SSBU d'UFA 2026, 4 h 02 de vidéo en 720p60, stream `Etoiles`, 10 sets.

| Mesure | Résultat |
|---|---|
| Durée de l'analyse | 90 s pour 4 h de vidéo |
| Sets alignés sur la vidéo | 10 sur 10, aucun partiel, aucun repli |
| Nombre de games | conforme au score sur les 10 sets |
| Biais estimé | -222 s, confiance 0,63 |
| Confiance par set | 0,73 à 0,97 |

Comparaison avec la génération par horaires Start.gg sur les mêmes sets :

| Mesure | Horaires seuls | Alignement |
|---|---|---|
| Durée cumulée des clips | 227 min | 170 min |
| Paires de clips qui se chevauchent | 5 | 0 |

L'alignement retire une cinquantaine de minutes de temps mort sans perdre une
game, et supprime les chevauchements où un set débordait sur le suivant.

Deux sets sont passés sous 0,80 de confiance et méritent un contrôle visuel :
Losers Quarter-Final Asimo contre Raflow, début repoussé de 462 s, et Losers
Final CS contre Asimo, début repoussé de 368 s.

### À faire au retour, dans l'ordre

1. **Contrôler visuellement** les deux sets sous 0,80 de confiance, pour savoir
   si l'écart aux horaires Start.gg est une vraie correction ou une game ratée.
2. **Construire l'interface** de l'alignement, maintenant que la détection est
   validée : bouton d'analyse à côté de l'import existant, barre de progression,
   et tableau des sets avec confiance et avertissements à valider avant
   génération des clips. Aujourd'hui tout se pilote en ligne de commande.

```bash
curl -X POST https://vod.bdiaby.fr/api/vods/<id>/align -H 'Content-Type: application/json' -d '{}'
curl -s https://vod.bdiaby.fr/api/vods/<id>/alignment
curl -X POST https://vod.bdiaby.fr/api/vods/<id>/clips-from-alignment -H 'Content-Type: application/json' -d '{}'
```

Attention : les deux méthodes de découpage écrivent des clips au même schéma de
nommage. Supprimer les clips existants avant de générer depuis l'alignement,
sinon doublons en base et fichiers écrasés.

3. **Tester sur un autre TO**, avec un overlay différent, pour savoir si la zone
   du HUD en dur tient ou s'il faut la calibrer par tournoi.
4. **Valider un upload YouTube** depuis un clip issu de l'alignement.

### Corrections apportées et déployées le 18 septembre

- **Parseur de score.** Le format réel est `Nom1 3 - Nom2 0`, le second score en
  fin de chaîne. Le parseur attendait `3 - 0` collé au tiret et ne reconnaissait
  donc jamais rien. La contrainte du nombre de games, cœur de l'alignement, ne
  s'appliquait pas. Tests écrits sur de vrais scores du tournoi.
- **Noms de stream.** Comparaison tolérante aux espaces et à la casse, aux deux
  endroits où elle se fait, et nettoyage à la saisie. Un `'Etoiles '` renvoyait
  zéro set sans message.
- **Téléchargement.** Huit fragments en parallèle, réglable par
  `YT_DLP_CONCURRENT_FRAGMENTS`. Contourne le bridage par connexion des
  plateformes.
- **Calibrage.** Disponible pour toute VOD liée à un event, plus seulement les
  fichiers locaux, avec bouton de recalibrage.
- **Liste de calibrage.** Limitée aux sets passés à l'antenne et groupée par
  phase. Sur UFA, on passe de près de mille sets à une cinquantaine.
- **Sélecteur d'épreuve.** Groupé par jeu, avec la journée dans le libellé.

### Limites connues du téléchargement

YouTube et Twitch refusent tous deux les adresses de datacenter d'Oracle Cloud :
`Sign in to confirm you're not a bot` côté YouTube. Le contournement par cookies
est déconseillé, yt-dlp documente que le compte Google associé se fait
fréquemment signaler, et c'est le même compte que celui de l'upload.

Le flux qui marche, et qui est de toute façon le vrai flux produit : le TO
fournit son enregistrement, ou on télécharge depuis un poste en connexion
résidentielle, puis on passe par l'upload de fichier.
