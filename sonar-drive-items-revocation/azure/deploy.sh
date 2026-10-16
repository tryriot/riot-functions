#!/usr/bin/env bash
# Deploys the receiver as an Azure Function App in the current az subscription. Run in Azure Cloud Shell (Bash):
#   git clone https://github.com/tryriot/riot-functions && ./riot-functions/sonar-drive-items-revocation/azure/deploy.sh
# The app reads Microsoft 365 as its own managed identity: no Entra app and no client secret.
# Needs only the Azure CLI and curl: the code comes prebuilt from the GitHub release.
# Optional: RESOURCE_GROUP (default riot-sonar-revoker), LOCATION (otherwise prompted on the first run),
# RELEASE_DIR to deploy a local build of the release assets (scripts/release.sh) instead of the published release.
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
# The marker stops the ERR trap from repeating a failure already explained in a subshell.
die() {
  printf '\n  %s✗ %s%s\n' "$RED$BOLD" "$*" "$RESET" >&2
  [ -d "${WORK:-}" ] && touch "$WORK/failed"
  exit 1
}
field() { printf '      %s%-16s%s %s\n' "$DIM" "$1" "$RESET" "$BOLD$2$RESET"; }
# Never stop without saying why: set -e alone exits silently.
trap '[ -e "${WORK:-}/failed" ] && exit 1; die "Failed at line $LINENO: $BASH_COMMAND. Fix it and rerun the script."' ERR
trap 'printf "\n"; die "Stopped. Rerun the script to continue."' INT
ask() { read -r "$@" || { echo; die "No input. Rerun the script to continue."; }; }
# Runs a command silently and only shows its output if it fails.
quietly() {
  local out
  if ! out=$(trap - ERR; "$@" 2>&1); then
    printf '%s\n' "$out" | sed 's/^/  /' >&2
    die "$1 $2 failed. Fix it and rerun the script."
  fi
}

RESOURCE_GROUP=${RESOURCE_GROUP:-riot-sonar-revoker}
LOCATION=${LOCATION:-}
EVENT_TYPE=revoke_drive_item_permission_request.created
GRAPH_APP_ID=00000003-0000-0000-c000-000000000000
GRAPH_ROLE=Files.ReadWrite.All
# Secrets go through files only readable by this user, never through command arguments.
WORK=$(mktemp -d)
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
# Puts a release asset in $WORK.
fetch() {
  if [ -n "${RELEASE_DIR:-}" ]; then
    cp "$RELEASE_DIR/$1" "$WORK/$1"
  else
    curl -fsSL --retry 3 -o "$WORK/$1" "$RELEASE/$1" 2>"$WORK/stderr" \
      || { sed 's/^/  /' "$WORK/stderr" >&2; die "Couldn't download $1 from $RELEASE."; }
  fi
}
# Escapes a value for a JSON string.
json_escape() { local v=${1//\\/\\\\}; printf '%s' "${v//\"/\\\"}"; }

printf '\n%sRiot Sonar revoker · Azure Functions%s\n' "$BOLD" "$RESET"
printf '%sYou can stop and rerun this script at any time: it picks up where it left off.%s\n' "$DIM" "$RESET"

step "1/4" "Subscription and region"
for tool in az curl; do
  command -v "$tool" >/dev/null || die "$tool is missing. Run this script in Azure Cloud Shell, or install $tool."
done
SUBSCRIPTION=$(az account show --query '[name, id]' -o tsv 2>/dev/null | paste -sd ' ' -) \
  || die "Not signed in. Run: az login"
[ -n "$SUBSCRIPTION" ] || die "Not signed in. Run: az login"
SUBSCRIPTION_ID=${SUBSCRIPTION##* }
ok "Subscription $BOLD${SUBSCRIPTION% *}$RESET ${DIM}($SUBSCRIPTION_ID)$RESET"
# New subscriptions have these resource providers unregistered, and the deploy fails without them.
PROVIDERS="Microsoft.Web Microsoft.Storage Microsoft.Insights Microsoft.OperationalInsights"
registered() { [ "$(az provider show --namespace "$1" --query registrationState -o tsv 2>/dev/null)" = Registered ]; }
missing=""
for ns in $PROVIDERS; do registered "$ns" || { quietly az provider register --namespace "$ns"; missing="$missing $ns"; }; done
if [ -n "$missing" ]; then
  printf '  %sActivating%s on this subscription, this takes 2 to 5 minutes…%s\n' "$DIM" "$missing" "$RESET"
  for ns in $missing; do until registered "$ns"; do sleep 10; done; done
fi
ok "Resource providers registered"
if [ "$(az group exists --name "$RESOURCE_GROUP")" != true ]; then
  quietly az group create --name "$RESOURCE_GROUP" --location "${LOCATION:-francecentral}"
fi
ok "Resource group $BOLD$RESOURCE_GROUP$RESET"

# Reruns redeploy the template, which replaces every app setting: carry the Riot secret over.
: > "$WORK/riot"
read -r APP APP_LOCATION < <(az functionapp list -g "$RESOURCE_GROUP" --query '[0].[name, location]' -o tsv 2>/dev/null | paste -sd ' ' -) || true
if [ -n "${APP:-}" ]; then
  az functionapp config appsettings list -g "$RESOURCE_GROUP" -n "$APP" \
    --query "[?name=='RIOT_WEBHOOK_SECRET'].value | [0]" -o tsv 2>/dev/null > "$WORK/riot" || true
  # The app can't move: keep its region ("France Central" becomes francecentral).
  LOCATION=$(printf '%s' "$APP_LOCATION" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
fi

choose_region() {
  printf '\n  Where should the app run? Pick the region closest to your Microsoft 365 data.\n\n'
  local i=1 r
  for r in "francecentral:France Central (Paris)" "swedencentral:Sweden Central" \
           "germanywestcentral:Germany West Central" "uksouth:UK South" \
           "eastus2:East US 2" "westus2:West US 2"; do
    printf '  %s%d%s  %-19s %s\n' "$BOLD" "$i" "$RESET" "${r%%:*}" "${r#*:}"; i=$((i + 1))
  done
  printf '  %s7%s  Another region (type its name, for example canadacentral)\n\n' "$BOLD" "$RESET"
  ask -p "  ${BOLD}?${RESET} Region [1]: " choice
  case "${choice:-1}" in
    1) LOCATION=francecentral ;; 2) LOCATION=swedencentral ;; 3) LOCATION=germanywestcentral ;;
    4) LOCATION=uksouth ;; 5) LOCATION=eastus2 ;; 6) LOCATION=westus2 ;;
    7) ask -p "  ${BOLD}?${RESET} Region name: " LOCATION ;;
    *) LOCATION=$choice ;;
  esac
}
write_params() {
  local riot=""
  [ -s "$WORK/riot" ] && riot=$(tr -d '\r\n' < "$WORK/riot")
  (umask 077; printf '{"parameters":{"location":{"value":"%s"},"releaseVersion":{"value":""},"riotWebhookSecret":{"value":"%s"}}}' \
    "$(json_escape "$LOCATION")" "$(json_escape "$riot")" > "$WORK/params.json")
}
fetch sonar-drive-items-revocation-azure.json
[ -n "$LOCATION" ] || choose_region
# Some regions refuse new subscriptions (West Europe does): find out before anything gets created.
while true; do
  write_params
  printf '  %sChecking that %s accepts the app…%s\n' "$DIM" "$LOCATION" "$RESET"
  az deployment group validate -g "$RESOURCE_GROUP" --template-file "$WORK/sonar-drive-items-revocation-azure.json" \
    --parameters "@$WORK/params.json" >/dev/null 2>"$WORK/validate.err" && break
  if grep -qE "not accepting new customers|LocationNotAvailable|NoRegisteredProviderFound|InvalidResourceLocation" "$WORK/validate.err"; then
    warn "$LOCATION can't host the app for this subscription. Pick another region."
    choose_region
  else
    sed 's/^/  /' "$WORK/validate.err" >&2
    die "Azure rejected the template. Fix it and rerun the script."
  fi
done
ok "Region $BOLD$LOCATION$RESET"

step "2/4" "Deploy"
fetch sonar-drive-items-revocation-azure.zip
printf '  %sCreating the Function App with release %s, this takes 2 to 3 minutes…%s\n' "$DIM" "$VERSION" "$RESET"
quietly az deployment group create -g "$RESOURCE_GROUP" --name riot-sonar-revoker \
  --template-file "$WORK/sonar-drive-items-revocation-azure.json" --parameters "@$WORK/params.json"
output() { az deployment group show -g "$RESOURCE_GROUP" --name riot-sonar-revoker --query "properties.outputs.$1.value" -o tsv; }
APP=$(output appName)
PRINCIPAL_ID=$(output principalId)
URL="https://$(az functionapp show -g "$RESOURCE_GROUP" -n "$APP" --query defaultHostName -o tsv)"
quietly az functionapp deployment source config-zip -g "$RESOURCE_GROUP" -n "$APP" --src "$WORK/sonar-drive-items-revocation-azure.zip"
ok "Deployed at $BOLD$URL$RESET"

step "3/4" "Allow access to OneDrive and SharePoint"
GRAPH_SP=$(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv)
ROLE_ID=$(az ad sp show --id "$GRAPH_APP_ID" --query "appRoles[?value=='$GRAPH_ROLE'].id | [0]" -o tsv)
ASSIGNMENTS="https://graph.microsoft.com/v1.0/servicePrincipals/$PRINCIPAL_ID/appRoleAssignments"
granted() { az rest --url "$ASSIGNMENTS" --query "value[?appRoleId=='$ROLE_ID'] | length(@)" -o tsv 2>/dev/null; }
GRANT_BODY="{\"principalId\":\"$PRINCIPAL_ID\",\"resourceId\":\"$GRAPH_SP\",\"appRoleId\":\"$ROLE_ID\"}"
grant() {
  # A brand-new identity takes a few seconds to reach Entra, so the first attempt can fail.
  for _ in 1 2 3; do
    az rest --method POST --url "$ASSIGNMENTS" --headers Content-Type=application/json --body "$GRANT_BODY" \
      >/dev/null 2>"$WORK/grant.err" && return 0
    sleep 20
  done
  return 1
}
if [ "$(granted)" = 1 ]; then
  ok "The app's identity already has $GRAPH_ROLE"
elif grant; then
  ok "Granted $GRAPH_ROLE to the app's identity"
else
  sed 's/^/  /' "$WORK/grant.err" >&2
  warn "Only a Global Administrator or a Privileged Role Administrator can grant $GRAPH_ROLE."
  printf '\n  Ask one to run this in Azure Cloud Shell, then rerun this script:\n\n'
  printf '  %saz rest --method POST --url %s \\\n    --headers Content-Type=application/json --body '"'"'%s'"'"'%s\n\n' \
    "$BOLD" "$ASSIGNMENTS" "$GRANT_BODY" "$RESET"
fi

step "4/4" "Connect Riot"
printf '  1. Open %shttps://hub.tryriot.com/settings/about%s and click the %sAPI%s tab.\n' "$CYAN" "$RESET" "$BOLD" "$RESET"
printf '  2. Click %sCreate endpoint%s and fill in:\n\n' "$BOLD" "$RESET"
field "Name" "Sonar revoker"
field "Endpoint URL" "$URL/api/webhook"
field "Events to send" "$EVENT_TYPE (only this one)"
printf '\n  3. Click %sCreate endpoint%s. Riot shows the signing secret once: copy it.\n\n' "$BOLD" "$RESET"
if [ -s "$WORK/riot" ]; then
  printf '  %sAlready connected? Press Enter to keep the current secret.%s\n' "$DIM" "$RESET"
fi

while true; do
  ask -sp "  ${BOLD}?${RESET} Paste the signing secret (whsec_…): " RIOT_SECRET; echo
  if [ -z "$RIOT_SECRET" ] || [[ "$RIOT_SECRET" == whsec_* ]]; then break; fi
  warn "The signing secret starts with whsec_. Try again."
done

if [ -n "$RIOT_SECRET" ]; then
  (umask 077; printf '{"RIOT_WEBHOOK_SECRET":"%s"}' "$(json_escape "$RIOT_SECRET")" > "$WORK/riot-setting.json")
  quietly az functionapp config appsettings set -g "$RESOURCE_GROUP" -n "$APP" --settings "@$WORK/riot-setting.json"
  ok "Signing secret saved"
elif [ -s "$WORK/riot" ]; then
  ok "Kept the current signing secret"
else
  warn "No signing secret yet: Riot's webhooks are rejected until you rerun this script and paste it."
fi

printf '\n%s━━ Check%s\n\n' "$BOLD$CYAN" "$RESET"
# The app restarts after each settings change and answers with the old settings until then, so
# wait for it to see the secret.
HEALTH=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  HEALTH=$(curl -fsS --max-time 20 "$URL/" 2>/dev/null || true)
  if [ -n "$HEALTH" ]; then
    [ -z "$RIOT_SECRET" ] && [ ! -s "$WORK/riot" ] && break
    [[ "$HEALTH" == *'"riotSecret":"ok"'* ]] && break
  fi
  sleep 10
done
MS_CHECK=$(curl -fsS --max-time 30 -X POST "$URL/api/check" -H 'content-type: application/json' \
  -d '{"provider":"microsoft"}' 2>/dev/null || true)
if [ -z "$HEALTH" ]; then
  warn "The app doesn't answer at $URL/ yet. Wait a minute and run: curl $URL/"
else
  case "$HEALTH" in
    *'"riotSecret":"ok"'*) ok "Riot signing secret" ;;
    *) warn "Riot signing secret: missing, rerun this script and paste it" ;;
  esac
  case "$MS_CHECK" in
    *'"ok":true'*) ok "Microsoft 365" ;;
    *) warn "Microsoft 365: $(m=$(printf '%s' "$MS_CHECK" | sed -nE 's/.*"message": *"(([^"\\]|\\.)*)".*/\1/p' | head -n 1 | sed 's/\\"/"/g'); printf '%s' "${m:-no answer from /api/check}")" ;;
  esac
fi

cat <<DONE

  Send a test from Riot: in the ${BOLD}API${RESET} tab, click ${BOLD}⋯${RESET} on the endpoint, then ${BOLD}Send test${RESET},
  pick ${BOLD}$EVENT_TYPE${RESET} and send it.
  Riot must show ${GREEN}"Your endpoint accepted the test"${RESET}. Nothing is revoked.

${BOLD}${GREEN}━━ Last step${RESET}

  Ask your Riot account manager to switch Sonar revocations to webhook mode.
  Each revocation then shows up in the logs as revoked, already_gone or skipped:
  ${CYAN}https://portal.azure.com/#@/resource/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$APP/logStream${RESET}

DONE
