#!/usr/bin/env bash
# Builds the GitHub release assets into release/. The deploy scripts download them, so customers never build.
# To test a deploy script against a local build: scripts/release.sh, then RELEASE_DIR=$PWD/release ./aws/deploy.sh
# --prebuilt packages the bundles already in dist/, as CI does with the ones the check job built.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "${1:-}" = --prebuilt ] || node scripts/build.mjs
cp gcp/Dockerfile dist/gcp/
rm -rf release
mkdir release
for platform in aws azure gcp; do
  (cd "dist/$platform" && zip -qr "../../release/sonar-drive-items-revocation-$platform.zip" .)
done
cp aws/template.yaml release/sonar-drive-items-revocation-aws.yaml
cp azure/azuredeploy.json release/sonar-drive-items-revocation-azure.json
(cd release && sha256sum sonar-drive-items-revocation-* > SHA256SUMS 2>/dev/null || shasum -a 256 sonar-drive-items-revocation-* > SHA256SUMS)
ls release
