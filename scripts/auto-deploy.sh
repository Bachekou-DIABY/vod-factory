#!/bin/bash
# Déploiement automatique, lancé toutes les 5 minutes par vod-factory-deploy.timer.
#
# Le serveur va chercher lui-même les nouveaux commits : le port 22 n'est
# ouvert qu'à une seule IP, GitHub ne peut donc pas s'y connecter.
#
# Un commit n'est déployé que si :
#   - la CI GitHub est passée dessus (en attente : on réessaie au tour suivant) ;
#   - aucun travail n'est en cours (téléchargement, alignement, découpe, envoi
#     YouTube). Redémarrer le backend en plein travail le relancerait de zéro :
#     une VOD de 11 Go se retéléchargeait entièrement.
#
# Les commits qui ne touchent ni le code ni les images Docker (doc, tests,
# fixtures, CI) sont simplement tirés, sans rebuild.
#
# Journal : journalctl -u vod-factory-deploy

set -euo pipefail

# Tout le corps est dans une fonction : bash lit un script au fur et à mesure,
# et le git merge ci-dessous peut réécrire ce fichier pendant qu'il tourne.
main() {
  local repo="Bachekou-DIABY/vod-factory"
  local branche="main"
  local env_file=".env.production"
  local etat=".auto-deploy-state"
  # Au-delà, un clip resté en UPLOADING est une trace d'un envoi interrompu,
  # pas un envoi en cours : il ne doit pas bloquer les déploiements à jamais.
  local envoi_max_minutes=60

  cd "$(dirname "$0")/.."

  exec 9>/tmp/vod-factory-deploy.lock
  flock -n 9 || { echo "Déploiement déjà en cours"; return 0; }

  git fetch --quiet origin "$branche"
  local local_sha distant_sha
  local_sha=$(git rev-parse HEAD)
  distant_sha=$(git rev-parse "origin/$branche")
  [ "$local_sha" = "$distant_sha" ] && return 0

  # N'écrit dans le journal que quand la situation change, pas toutes les 5 min.
  signaler() {
    local cle="$distant_sha:$1"
    if [ "$(cat "$etat" 2>/dev/null || true)" != "$cle" ]; then
      echo "$cle" > "$etat"
      echo "${distant_sha:0:7} : $2"
    fi
  }

  if ! git merge-base --is-ancestor HEAD "origin/$branche"; then
    signaler divergent "le serveur a des commits absents de GitHub, déploiement manuel requis"
    return 0
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    signaler modifie "fichiers modifiés à la main sur le serveur, déploiement manuel requis"
    return 0
  fi

  local ci
  ci=$(curl -fsS "https://api.github.com/repos/$repo/actions/runs?head_sha=$distant_sha&event=push" |
    python3 -c '
import json, sys
runs = [r for r in json.load(sys.stdin)["workflow_runs"] if r["name"] == "CI"]
if not runs: print("absente")
elif runs[0]["status"] != "completed": print("encours")
else: print(runs[0]["conclusion"])
') || ci="injoignable"

  case "$ci" in
    success) ;;
    encours|absente) signaler attente "CI pas encore terminée, on attend"; return 0 ;;
    injoignable) signaler injoignable "API GitHub injoignable, on réessaie"; return 0 ;;
    *) signaler ci-rouge "CI en échec ($ci), commit non déployé"; return 0 ;;
  esac

  local occupe
  occupe=$(travail_en_cours "$env_file" "$envoi_max_minutes")
  if [ -n "$occupe" ]; then
    signaler occupe "travail en cours ($occupe), déploiement reporté"
    return 0
  fi

  local fichiers
  fichiers=$(git diff --name-only HEAD "origin/$branche")

  echo "${distant_sha:0:7} : déploiement de $(git log --oneline HEAD.."origin/$branche" | wc -l) commit(s)"
  git merge --quiet --ff-only "origin/$branche"

  if echo "$fichiers" | grep -qvE '(\.md$|\.spec\.ts$|/__fixtures__/|^\.github/|^scripts/)'; then
    if ./deploy.sh --build; then
      signaler deploye "déployé"
    else
      signaler build-rate "échec du build, l'ancienne version tourne toujours"
      return 1
    fi
  else
    signaler tire "rien à reconstruire (doc, tests ou scripts), code tiré seulement"
  fi
}

# Affiche ce qui tourne encore, ou rien si le serveur est au repos.
travail_en_cours() {
  local env_file=$1 envoi_max=$2
  local compose=(docker compose -f docker-compose.production.yml --env-file "$env_file")
  local occupe=()

  # BullMQ garde les jobs en cours dans bull:<file>:active. Les jobs en
  # attente, eux, survivent au redémarrage : ils ne bloquent rien.
  local cle n
  for cle in $("${compose[@]}" exec -T redis redis-cli --scan --pattern 'bull:*:active'); do
    n=$("${compose[@]}" exec -T redis redis-cli LLEN "$cle")
    [ "$n" -gt 0 ] && occupe+=("$(echo "$cle" | cut -d: -f2) : $n")
  done

  # Les envois YouTube tournent dans le process du backend, hors file.
  local pg_user
  pg_user=$(grep -E '^POSTGRES_USER=' "$env_file" | cut -d= -f2- || true)
  n=$("${compose[@]}" exec -T postgres psql -U "${pg_user:-postgres}" -d vod_factory -tAc \
    "SELECT count(*) FROM clips WHERE status = 'UPLOADING' AND \"updatedAt\" > now() - interval '$envoi_max minutes'")
  [ "$n" -gt 0 ] && occupe+=("envoi YouTube : $n")

  local IFS=,
  echo "${occupe[*]}"
}

main "$@"
exit $?
