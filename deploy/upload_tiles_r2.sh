#!/usr/bin/env bash
# Upload data/tiles to a Cloudflare R2 bucket with rclone (S3 API).
# Credentials are read from ~/.config/cosmic-atlas/r2.env (chmod 600), never from the repo:
#   R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_BUCKET=cosmic-atlas-tiles
# Usage: deploy/upload_tiles_r2.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${R2_ENV_FILE:-$HOME/.config/cosmic-atlas/r2.env}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}"
command -v rclone >/dev/null || { echo "rclone not installed (brew install rclone)"; exit 1; }

export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

.venv/bin/python scripts/write_tiles_index.py data/tiles   # static _index.json next to the layers
# synthetic-* layers are dev data; skip them. Tiles are immutable per build -> long cache.
rclone sync data/tiles "r2:${R2_BUCKET}" "$@" \
  --exclude "synthetic-*/**" --transfers 16 --checkers 32 --fast-list \
  --header-upload "Cache-Control: public, max-age=604800" \
  --s3-no-check-bucket --progress
echo "uploaded; check: curl -I https://<your-domain>/galaxies-desi/meta.json"
