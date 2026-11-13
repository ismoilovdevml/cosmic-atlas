#!/usr/bin/env bash
# Rebuild every tile layer from data/raw/<layer>/ (see docs/data-contract.md).
# Layers whose raw directory is missing are skipped with a note.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
B="$PY pipeline/build_tiles.py"

build() {  # layer, then builder args
  local layer=$1; shift
  if compgen -G "data/raw/$layer/*.parquet" > /dev/null; then
    $B "$layer" "$@" 2>&1 | tail -1
  else
    echo "[$layer] skipped: no data/raw/$layer/*.parquet"
  fi
}

# Stars: Gaia DR3 chunks only (Hipparcos supplement has HIP ids, so it is its own layer).
build stars-gaia    --order lum --kind-model star --title "Gaia DR3 stars within 1 kpc" \
                    --id-prefix "Gaia DR3 " --glob "gaia_chunk_*.parquet"
if [ -f data/raw/stars-gaia/bright_supplement.parquet ]; then
  $B stars-bright --src data/raw/stars-gaia --glob "bright_supplement.parquet" \
     --order lum --kind-model star --title "Bright stars (Hipparcos supplement)" --id-prefix "HIP " 2>&1 | tail -1
fi
build galaxies-desi --order random --kind-model galaxy --title "DESI DR1 galaxies and quasars" --id-prefix "DESI "
build galaxies-2mrs --order random --kind-model galaxy --title "2MASS Redshift Survey"
build galaxies-cf4  --order random --kind-model galaxy --title "Cosmicflows-4"
build local-group   --order random --kind-model galaxy --title "Local Group (McConnachie)"
build local-volume  --order random --kind-model galaxy --title "Local Volume (UNGC)"
du -sh data/tiles/* | sort -h
