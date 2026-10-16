#!/usr/bin/env bash
# Deploys the receiver to Cloud Run in the current gcloud project. Run in Cloud Shell:
#   git clone https://github.com/tryriot/riot-functions && ./riot-functions/sonar-drive-items-revocation/gcp/deploy.sh
# Optional: REGION (default europe-west1), SERVICE (default riot-sonar-revoker),
# MS_TENANT_ID and MS_CLIENT_ID to enable Microsoft 365 (the client secret is prompted),
# RELEASE_DIR to deploy a local build of the release assets (scripts/release.sh) instead of the published release.
# Needs only gcloud, curl and unzip: the code comes prebuilt from the GitHub release.
set -Eeuo pipefail

VERSION=1.0.0
RELEASE=https://github.com/tryriot/riot-functions/releases/download/sonar-drive-items-revocation-v$VERSION

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi
step() { printf '\n%s%s━━ %s %s%s\n\n' "$BOLD" "$CYAN" "$1" "${DIM}$2" "$RESET"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() { printf '\n  %s✗ %s%s\n' "$RED$BOLD" "$*" "$RESET" >&2; exit 1; }
field() { printf '      %s%-16s%s %s\n' "$DIM" "$1" "$RESET" "$BOLD$2$RESET"; }
# Never stop without saying why: set -e alone exits silently.
trap 'die "Failed at line $LINENO: $BASH_COMMAND. Fix it and rerun the script."' ERR
trap 'printf "\n"; die "Stopped. Rerun the script to continue."' INT
ask() { read -r "$@" || { echo; die "No input. Rerun the script to continue."; }; }
# Runs a command silently and only shows its output if it fails.
quietly() {
  local out
  if ! out=$("$@" 2>&1); then printf '%s\n' "$out" >&2; return 1; fi
}

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
# Puts a release asset in $STAGE.
fetch() {
  if [ -n "${RELEASE_DIR:-}" ]; then
    cp "$RELEASE_DIR/$1" "$STAGE/$1"
  else
    curl -fsSL --retry 3 -o "$STAGE/$1" "$RELEASE/$1" 2>"$STAGE/stderr" \
      || { sed 's/^/  /' "$STAGE/stderr" >&2; die "Couldn't download $1 from $RELEASE."; }
  fi
}

for tool in gcloud curl unzip; do
  command -v "$tool" >/dev/null || die "$tool is missing. Run this script in Cloud Shell, or install $tool."
done
PROJECT=$(gcloud config get-value project 2>/dev/null)
REGION=${REGION:-europe-west1}
SERVICE=${SERVICE:-riot-sonar-revoker}
SA_NAME=${SA_NAME:-riot-sonar-revoker}
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
BUILD_SA="${SA_NAME}-build@${PROJECT}.iam.gserviceaccount.com"
RIOT_SECRET_NAME=sonar-revocation-riot-secret
RIOT_SECRET_REF="RIOT_WEBHOOK_SECRET=$RIOT_SECRET_NAME:latest"
EVENT_TYPE=revoke_drive_item_permission_request.created

printf '\n%sRiot Sonar revoker · Google Cloud Run%s\n' "$BOLD" "$RESET"
printf '%sYou can stop and rerun this script at any time: it picks up where it left off.%s\n' "$DIM" "$RESET"

step "1/5" "Project"
[ -n "$PROJECT" ] || die "No project selected. Run: gcloud config set project <project-id>"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)' 2>/dev/null) \
  || die "Project $PROJECT not found, or $(gcloud config get-value account 2>/dev/null) can't access it."
[ "$(gcloud billing projects describe "$PROJECT" --format 'value(billingEnabled)' 2>/dev/null)" = True ] \
  || die "Billing is off for $PROJECT. Turn it on: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
ok "Project $BOLD$PROJECT$RESET, region $REGION, service $SERVICE"

step "2/5" "APIs, service accounts and secrets"
quietly gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  iamcredentials.googleapis.com drive.googleapis.com secretmanager.googleapis.com
ok "APIs enabled"

if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  quietly gcloud iam service-accounts create "$SA_NAME" --display-name "Riot Sonar revoker"
fi
# Lets the service sign its own domain-wide delegation assertions, so no key file ever exists.
quietly gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator
ok "Runtime service account $SA"

# Builds run as their own account: new projects no longer grant the default compute account any role.
if ! gcloud iam service-accounts describe "$BUILD_SA" >/dev/null 2>&1; then
  quietly gcloud iam service-accounts create "${SA_NAME}-build" --display-name "Riot Sonar revoker build"
fi
quietly gcloud projects add-iam-policy-binding "$PROJECT" --condition=None \
  --member "serviceAccount:$BUILD_SA" --role roles/cloudbuild.builds.builder
ok "Build service account $BUILD_SA"

put_secret() {
  local name=$1 value=$2
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | quietly gcloud secrets versions add "$name" --data-file=-
  else
    printf '%s' "$value" | quietly gcloud secrets create "$name" --replication-policy automatic --data-file=-
  fi
  quietly gcloud secrets add-iam-policy-binding "$name" \
    --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
}

ENV_VARS="GOOGLE_SERVICE_ACCOUNT_EMAIL=$SA"
SECRETS=""
HAS_RIOT_SECRET=""
# Riot only shows the signing secret once the endpoint exists, and the endpoint needs this service's URL,
# so the first deploy runs without it and the secret is asked for after the URL is known.
if gcloud secrets describe "$RIOT_SECRET_NAME" >/dev/null 2>&1; then
  SECRETS="$RIOT_SECRET_REF"
  HAS_RIOT_SECRET=1
fi

if [ -n "${MS_CLIENT_ID:-}" ]; then
  : "${MS_TENANT_ID:?set MS_TENANT_ID with MS_CLIENT_ID}"
  ask -sp "  ${BOLD}?${RESET} Entra client secret: " MS_SECRET; echo
  put_secret sonar-revocation-ms-secret "$MS_SECRET"
  SECRETS="${SECRETS:+$SECRETS,}MS_CLIENT_SECRET=sonar-revocation-ms-secret:latest"
  ENV_VARS="$ENV_VARS,MS_TENANT_ID=$MS_TENANT_ID,MS_CLIENT_ID=$MS_CLIENT_ID"
  ok "Microsoft 365 client secret saved"
fi

step "3/5" "Deploy"
fetch sonar-drive-items-revocation-gcp.zip
# The zip holds the bundled server and its Dockerfile, which Cloud Build turns into the image.
quietly unzip -o "$STAGE/sonar-drive-items-revocation-gcp.zip" -d "$STAGE/source"

printf '  %sDeploying release %s on Cloud Run, this takes 2 to 4 minutes…%s\n' "$DIM" "$VERSION" "$RESET"
# --no-invoker-iam-check makes the service public without granting allUsers, which domain-restricted
# organizations forbid. Every webhook is still checked against the Riot signature.
quietly gcloud run deploy "$SERVICE" --source "$STAGE/source" --region "$REGION" --quiet \
  --build-service-account "projects/$PROJECT/serviceAccounts/$BUILD_SA" \
  --service-account "$SA" --no-invoker-iam-check \
  --memory 256Mi --max-instances 5 --timeout 60 \
  --update-env-vars "$ENV_VARS" ${SECRETS:+--update-secrets "$SECRETS"}
ok "Deployed at $BOLD$URL$RESET"

step "4/5" "Connect Riot"
printf '  1. Open %shttps://hub.tryriot.com/settings/about%s and click the %sAPI%s tab.\n' "$CYAN" "$RESET" "$BOLD" "$RESET"
printf '  2. Click %sCreate endpoint%s and fill in:\n\n' "$BOLD" "$RESET"
field "Name" "Sonar revoker"
field "Endpoint URL" "$URL/api/webhook"
field "Events to send" "$EVENT_TYPE (only this one)"
printf '\n  3. Click %sCreate endpoint%s. Riot shows the signing secret once: copy it.\n\n' "$BOLD" "$RESET"
if [ -n "$HAS_RIOT_SECRET" ]; then
  printf '  %sAlready connected? Press Enter to keep the current secret.%s\n' "$DIM" "$RESET"
fi

while true; do
  ask -sp "  ${BOLD}?${RESET} Paste the signing secret (whsec_…): " RIOT_SECRET; echo
  if [ -z "$RIOT_SECRET" ] || [[ "$RIOT_SECRET" == whsec_* ]]; then break; fi
  warn "The signing secret starts with whsec_. Try again."
done

if [ -n "$RIOT_SECRET" ]; then
  put_secret "$RIOT_SECRET_NAME" "$RIOT_SECRET"
  quietly gcloud run services update "$SERVICE" --region "$REGION" --update-secrets "$RIOT_SECRET_REF"
  ok "Signing secret saved"
elif [ -n "$HAS_RIOT_SECRET" ]; then
  ok "Kept the current signing secret"
else
  warn "No signing secret yet: Riot's webhooks are rejected until you rerun this script and paste it."
fi

CLIENT_ID=$(gcloud iam service-accounts describe "$SA" --format 'value(oauth2ClientId)')
step "5/5" "Allow access to Google Drive"
printf '  1. Open %shttps://admin.google.com/ac/owl/domainwidedelegation%s as a Google Workspace super admin.\n' "$CYAN" "$RESET"
printf '  2. Click %sAdd new%s and fill in:\n\n' "$BOLD" "$RESET"
field "Client ID" "$CLIENT_ID"
field "OAuth scopes" "https://www.googleapis.com/auth/drive"
printf '\n  3. Click %sAuthorize%s.\n\n' "$BOLD" "$RESET"
ask -p "  ${BOLD}?${RESET} Press Enter once it's done. "

printf '\n%s━━ Check%s\n\n' "$BOLD$CYAN" "$RESET"
HEALTH=$(curl -fsS "$URL/" 2>/dev/null || true)
check() {
  case "$HEALTH" in
    *"\"$1\":\"ok\""*) ok "$2" ;;
    *"\"$1\":\"missing\""*) printf '  %s–%s %s %snot configured%s\n' "$DIM" "$RESET" "$2" "$DIM" "$RESET" ;;
    *) warn "$2: $3" ;;
  esac
}
if [ -z "$HEALTH" ]; then
  warn "The service doesn't answer at $URL/ yet. Wait a minute and run: curl $URL/"
else
  check riotSecret "Riot signing secret" "missing, rerun this script and paste it"
  check google "Google Workspace"
  check microsoft "Microsoft 365"
fi

cat <<DONE

  Send a test from Riot: in the ${BOLD}API${RESET} tab, click ${BOLD}⋯${RESET} on the endpoint, then ${BOLD}Send test${RESET},
  pick ${BOLD}$EVENT_TYPE${RESET} and send it.
  Riot must show ${GREEN}"Your endpoint accepted the test"${RESET}. Nothing is revoked.

${BOLD}${GREEN}━━ Last step${RESET}

  Ask your Riot account manager to switch Sonar revocations to webhook mode.
  Each revocation then shows up in the logs as revoked, already_gone or skipped:
  ${CYAN}https://console.cloud.google.com/run/detail/$REGION/$SERVICE/logs?project=$PROJECT${RESET}

DONE
