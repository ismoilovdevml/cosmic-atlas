#!/usr/bin/env bash
# Deploy the viewer + a tile set to Cloudflare Pages (project "cosmic-atlas", classic Pages).
#
# Free-plan limits checked 2026-11-13 (developers.cloudflare.com/pages/platform/limits):
# 20,000 files per site, 25 MiB per file; no total-size or bandwidth limit is stated.
#
# Usage: deploy/cloudflare_pages.sh [tile-dir]
#   tile-dir defaults to a fresh copy of data/tiles without synthetic-* layers.
# Needs `npx wrangler login` once (scopes: account:read user:read pages:write).
#
# Two wrangler 4.16x pitfalls this script avoids:
#   * run inside web/, `wrangler pages ...` "auto-configures" the project for Workers: it edits
#     package.json, vite.config.ts, adds wrangler.jsonc. So wrangler runs from an empty temp dir.
#   * `pages project create` delegates to Workers unless --force; the project already exists, so
#     only `pages deploy` is used here (no --force needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SITE="$WORK/site"

(cd "$ROOT/web" && npm run build >/dev/null)
cp -R "$ROOT/web/dist" "$SITE"

if [ $# -ge 1 ]; then
  cp -R "$1" "$SITE/tiles"
else
  args=()
  for d in "$ROOT"/data/tiles/synthetic-*; do [ -d "$d" ] && args+=(--exclude "$(basename "$d")"); done
  "$ROOT/.venv/bin/python" "$ROOT/scripts/make_lite_tiles.py" "$SITE/tiles" --budget-mb 100000 "${args[@]}"
fi
rm -f "$SITE/tiles/catalogs/dev-placeholder.json"
"$ROOT/.venv/bin/python" "$ROOT/scripts/write_tiles_index.py" "$SITE/tiles"
printf '/tiles/*\n  Cache-Control: public, max-age=86400\n' > "$SITE/_headers"

files=$(find "$SITE" -type f | wc -l | tr -d ' ')
big=$(find "$SITE" -type f -size +24M)
echo "site: $files files, $(du -sh "$SITE" | cut -f1)"
[ "$files" -le 20000 ] || { echo "too many files for Pages free (20,000)"; exit 1; }
[ -z "$big" ] || { echo "files over 24 MB: $big"; exit 1; }
[ -z "$(find "$SITE" -type l)" ] || { echo "symlinks in site"; exit 1; }

mkdir "$WORK/cwd" && cd "$WORK/cwd"
npx --yes wrangler@4 pages deploy "$SITE" --project-name cosmic-atlas --branch main --commit-dirty=true
