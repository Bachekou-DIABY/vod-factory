#!/usr/bin/env bash
#
# Création d'instance OCI avec réessai jusqu'à obtention de capacité.
#
# La capacité Ampere A1 du tier gratuit se libère par à-coups de quelques
# secondes. Ce script relance la création en boucle jusqu'à ce qu'une fenêtre
# s'ouvre, et s'arrête immédiatement sur toute erreur qui n'est pas un manque
# de capacité — inutile de réessayer mille fois une configuration invalide.
#
# Prérequis : OCI CLI installé et configuré (oci setup config).
#
# Usage :
#   ./scripts/oci-launch-retry.sh              # découverte + confirmation
#   ./scripts/oci-launch-retry.sh --yes        # démarre sans confirmation
#
# Réglages via variables d'environnement, voir la section CONFIGURATION.

set -uo pipefail

# ---------------------------------------------------------------- CONFIGURATION

DISPLAY_NAME="${DISPLAY_NAME:-vod-factory}"
SHAPE="${SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${OCPUS:-2}"
MEMORY_GB="${MEMORY_GB:-12}"
# Quota de 200 Go sur tout le tenancy, dont 47 pris par le portfolio : 150 est
# le maximum pratique. Le boot volume orphelin de mars doit être supprimé avant.
BOOT_VOLUME_GB="${BOOT_VOLUME_GB:-150}"
OS_NAME="${OS_NAME:-Canonical Ubuntu}"
OS_VERSION="${OS_VERSION:-24.04}"
SSH_KEY_PATH="${SSH_KEY_PATH:-/c/Users/bacdi/Downloads/Oracle Cloud/ssh-key-2026-03-16.key.pub}"

# Intervalle entre deux tentatives. En dessous de 60s, OCI répond
# "Too many requests" et la fenêtre de blocage s'allonge.
RETRY_DELAY="${RETRY_DELAY:-90}"

# Renseigne-les pour court-circuiter la découverte automatique.
COMPARTMENT_ID="${COMPARTMENT_ID:-}"
SUBNET_ID="${SUBNET_ID:-}"
IMAGE_ID="${IMAGE_ID:-}"
AVAILABILITY_DOMAIN="${AVAILABILITY_DOMAIN:-}"

LOG_FILE="${LOG_FILE:-oci-launch-retry.log}"

# --------------------------------------------------------------------- OUTILLAGE

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

die() {
  log "ERREUR: $*"
  exit 1
}

# L'installateur officiel échoue sur Python 3.14 faute de wheel PyYAML, donc la
# CLI vit dans un venv Python 3.11 dédié. On la cherche là en priorité, sans
# imposer de modification du PATH système.
resolve_oci() {
  if [ -n "${OCI_BIN:-}" ]; then
    printf '%s' "$OCI_BIN"
  elif [ -x "$HOME/.oci-cli-venv/Scripts/oci.exe" ]; then
    printf '%s' "$HOME/.oci-cli-venv/Scripts/oci.exe"
  elif [ -x "$HOME/.oci-cli-venv/bin/oci" ]; then
    printf '%s' "$HOME/.oci-cli-venv/bin/oci"
  else
    command -v oci 2>/dev/null || true
  fi
}

OCI=$(resolve_oci)

oci_query() {
  # Renvoie une valeur scalaire, chaîne vide si absente.
  "$OCI" "$@" --raw-output 2>/dev/null || true
}

# --------------------------------------------------------------------- DÉCOUVERTE

[ -n "$OCI" ] || die "OCI CLI introuvable. Installe-la puis lance 'oci setup config'."
"$OCI" --version >/dev/null 2>&1 || die "OCI CLI présente mais non exécutable: $OCI"
[ -f "$SSH_KEY_PATH" ] || die "Clé publique introuvable: $SSH_KEY_PATH"

# Vérifie l'authentification avant tout le reste, et affiche l'erreur réelle.
# Sans ça, un défaut de configuration se traduirait par des découvertes vides
# et des messages trompeurs sur les ressources.
if ! auth_check=$("$OCI" iam region list 2>&1); then
  log "Appel authentifié refusé par OCI :"
  printf '%s\n' "$auth_check" | tail -5
  die "Vérifie 'oci setup config' et que la clé API est bien déclarée dans la console."
fi

if [ -z "$COMPARTMENT_ID" ]; then
  # Le compartiment racine porte l'OCID du tenancy. On le lit dans la config
  # plutôt que via l'API : lister les compartiments ne renvoie que les enfants,
  # donc rien du tout sur un tenancy qui travaille à la racine.
  OCI_CONFIG="${OCI_CONFIG:-$HOME/.oci/config}"
  [ -f "$OCI_CONFIG" ] || die "Config OCI introuvable: $OCI_CONFIG. Lance 'oci setup config'."
  COMPARTMENT_ID=$(grep -E '^[[:space:]]*tenancy[[:space:]]*=' "$OCI_CONFIG" \
    | head -1 | cut -d= -f2- | tr -d ' \r\n')
  [ -n "$COMPARTMENT_ID" ] || die "Aucun 'tenancy' dans $OCI_CONFIG. Renseigne COMPARTMENT_ID."
fi

if [ -z "$AVAILABILITY_DOMAIN" ]; then
  AVAILABILITY_DOMAIN=$(oci_query iam availability-domain list \
    --compartment-id "$COMPARTMENT_ID" --query 'data[0].name')
  [ -n "$AVAILABILITY_DOMAIN" ] || die "Aucun domaine de disponibilité trouvé."
fi

if [ -z "$IMAGE_ID" ]; then
  # La plus récente image compatible avec le shape : sur A1 elle est en aarch64.
  IMAGE_ID=$(oci_query compute image list \
    --compartment-id "$COMPARTMENT_ID" \
    --operating-system "$OS_NAME" \
    --operating-system-version "$OS_VERSION" \
    --shape "$SHAPE" \
    --sort-by TIMECREATED --sort-order DESC \
    --query 'data[0].id')
  [ -n "$IMAGE_ID" ] || die "Aucune image $OS_NAME $OS_VERSION pour le shape $SHAPE."
fi

if [ -z "$SUBNET_ID" ]; then
  SUBNET_COUNT=$(oci_query network subnet list --compartment-id "$COMPARTMENT_ID" --query 'length(data)')
  if [ "${SUBNET_COUNT:-0}" != "1" ]; then
    log "Plusieurs sous-réseaux trouvés, choisis-en un et relance avec SUBNET_ID=..."
    "$OCI" network subnet list --compartment-id "$COMPARTMENT_ID" \
      --query 'data[].{nom:"display-name",id:id,prive:"prohibit-public-ip-on-vnic"}' --output table
    exit 1
  fi
  SUBNET_ID=$(oci_query network subnet list --compartment-id "$COMPARTMENT_ID" --query 'data[0].id')
  [ -n "$SUBNET_ID" ] || die "Aucun sous-réseau trouvé."
fi

SSH_KEY=$(cat "$SSH_KEY_PATH")

# ------------------------------------------------------------------ RÉCAPITULATIF

cat <<EOF

  Instance          : $DISPLAY_NAME
  Shape             : $SHAPE  —  ${OCPUS} OCPU / ${MEMORY_GB} Go
  Boot volume       : ${BOOT_VOLUME_GB} Go
  Domaine dispo     : $AVAILABILITY_DOMAIN
  Image             : $IMAGE_ID
  Sous-réseau       : $SUBNET_ID
  Clé publique      : $SSH_KEY_PATH
  Intervalle        : ${RETRY_DELAY}s
  Journal           : $LOG_FILE

EOF

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Lancer la boucle ? [o/N] " answer
  case "$answer" in
    o | O | y | Y) ;;
    *) echo "Annulé."; exit 0 ;;
  esac
fi

# ------------------------------------------------------------------------ BOUCLE

log "Démarrage de la boucle de création pour $DISPLAY_NAME"

attempt=0
while true; do
  attempt=$((attempt + 1))

  output=$("$OCI" compute instance launch \
    --availability-domain "$AVAILABILITY_DOMAIN" \
    --compartment-id "$COMPARTMENT_ID" \
    --shape "$SHAPE" \
    --shape-config "{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}" \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --boot-volume-size-in-gbs "$BOOT_VOLUME_GB" \
    --display-name "$DISPLAY_NAME" \
    --assign-public-ip true \
    --metadata "{\"ssh_authorized_keys\":\"${SSH_KEY}\"}" \
    --wait-for-state RUNNING \
    2>&1)
  status=$?

  if [ $status -eq 0 ]; then
    log "Instance créée après $attempt tentative(s)."
    printf '%s\n' "$output" | tee -a "$LOG_FILE"
    log "Récupère l'IP publique avec: oci compute instance list-vnics --instance-id <ocid> --query 'data[0].\"public-ip\"' --raw-output"
    exit 0
  fi

  # Manque de capacité : c'est le cas nominal, on réessaie.
  if printf '%s' "$output" | grep -qiE 'out of (host )?capacity|OutOfCapacity|InternalError'; then
    log "Tentative $attempt — capacité indisponible, nouvel essai dans ${RETRY_DELAY}s"
    sleep "$RETRY_DELAY"
    continue
  fi

  # Throttling : on laisse retomber plus longtemps avant de reprendre.
  if printf '%s' "$output" | grep -qiE 'TooManyRequests|Too many requests'; then
    log "Tentative $attempt — limitation de débit, pause de $((RETRY_DELAY * 4))s"
    sleep $((RETRY_DELAY * 4))
    continue
  fi

  # Toute autre erreur est structurelle : quota, OCID invalide, droits.
  log "Échec non lié à la capacité, arrêt de la boucle."
  printf '%s\n' "$output" | tee -a "$LOG_FILE"
  exit 1
done
