# Cosmic Atlas

A browser 3D map of the universe built only from public survey data. One continuous scene
covers the Sun and the nearest stars, the Gaia stars out to 1 kpc, the Milky Way, the Local
Group and Local Volume, and the DESI cosmic web out to z ≈ 7. It has search, layers, a
scale tour, and deep links to any object.

![DESI DR1 cosmic web, thin slab ±75 Mpc at 1 Gpc](figures/viewer-1Gpc-slab.png)

## What it does differently

Several maps already fly from the Solar System to the cosmic web. The closest are
[skymap](https://github.com/rulkens/skymap) (MIT, WebGPU), Space Time and Lightcone; the full
survey is in [docs/prior-work.md](docs/prior-work.md). What this project adds:

- **Full catalogues, streamed.** All 15.1 M DESI DR1 objects that pass the confident-redshift
  cuts, and tens of millions of Gaia stars. Neither is curated down to a few million points.
  Each layer is an additive-LOD octree, and the viewer streams nodes under a global point budget.
- **Distance uncertainty.** Every point carries its 16th/84th percentile distance. The info
  card shows the range, a selected object gets a 3D line-of-sight error bar, and a display mode
  stretches points along the line of sight by their error.
- **Honest light.** A subtree that isn't loaded is drawn as one blob only while it is smaller
  than about 6 px. Larger unresolved light is reported as "pending", never smeared. Brightness
  is per unit solid angle, so it doesn't depend on canvas size or field of view.
- **Provenance.** Each layer has a re-runnable fetch script and a `PROVENANCE.json` with the
  query, service, UTC time, row counts, cuts and citations.
- **Correct cosmology.** Planck18 comoving distances throughout. Galaxy brightness uses the
  luminosity distance, and lookback times are exact.

Rendering is WebGPU-first: three.js `three/webgpu` with TSL materials, falling back to WebGL2
automatically on browsers without WebGPU.

## Layers (v1)

| Layer | Objects | Source | Distances |
|---|---|---|---|
| `stars-gaia` | Gaia DR3, d < 1 kpc, parallax S/N > 10, RUWE < 1.4 | ESA Gaia archive TAP | Bailer-Jones et al. 2021 geometric |
| `stars-bright` | Hipparcos stars too bright for Gaia | VizieR I/311 | 1/parallax |
| `galaxies-desi` | 15,140,002 (13.56 M galaxies, 1.58 M QSOs) | DESI DR1 via Astro Data Lab TAP | Planck18 comoving from z |
| `galaxies-2mrs` | 43,463 | 2MRS (Huchra et al. 2012) | Planck18 from cz; redshift-independent below z = 0.003 |
| `galaxies-cf4` | 55,877 | Cosmicflows-4 (Tully et al. 2023) | redshift-independent |
| `local-group` | 146 | McConnachie 2012, 2021 update | distance moduli |
| `local-volume` | 868 | UNGC (Karachentsev et al. 2013) | redshift-independent where available |
| catalogues | 653 IAU star names, 588 Messier/NGC/IC | IAU WGSN list, OpenNGC, SIMBAD | see each entry's `ref` |
| Milky Way model | spiral arms, bar, disc | Reid et al. 2019; R0 = 8275 pc (GRAVITY 2021) | a model, labelled as one |
| sky sphere | Gaia DR3 integrated flux | ESA/Gaia/DPAC | background beyond 1 kpc |

## Reproduce

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv numpy pandas pyarrow astropy astroquery pyvo requests pytest

.venv/bin/python scripts/fetch_gaia.py all            # resumable; hours on the anonymous ESA TAP
.venv/bin/python scripts/fetch_desi.py
.venv/bin/python scripts/fetch_local_universe.py
.venv/bin/python scripts/build_named.py
.venv/bin/python scripts/validate_layers.py           # landmark checks, exit 1 on failure

scripts/build_all_tiles.sh                            # data/raw -> data/tiles
.venv/bin/python -m pytest tests                      # tile builder tests

cd web && npm ci && npm run dev                       # http://localhost:5173
```

`data/raw/` and `data/tiles/` are gitignored. Raw data is about 7 GB and the tiles about 2 GB.
The small named-object catalogues in `data/tiles/catalogs/` are committed.

## Layout

```
docs/data-contract.md   frame, units, Parquet columns, tile format (single source of truth)
docs/prior-work.md      survey of existing maps, data and rendering tech
docs/skymap-lessons.md  what we learned from skymap's source and where we differ
scripts/                fetchers, validation, build_all_tiles.sh
pipeline/build_tiles.py Parquet -> octree tiles
web/                    viewer (see web/README.md)
figures/                viewer captures
```

## Credits and licences

- Gaia: ESA/Gaia/DPAC, data under **CC BY-NC 3.0 IGO**, so this project is non-commercial.
  Distances: Bailer-Jones et al. 2021, AJ 161, 147.
- DESI DR1: DESI Collaboration 2025 (arXiv:2503.14745), **CC BY 4.0**.
- 2MRS, Cosmicflows-4, McConnachie, UNGC, Hipparcos, OpenNGC, SIMBAD: see each layer's
  `PROVENANCE.json` for the citation and DOI.
- Several rendering techniques (subtree light blobs, solid-angle photometry, the brightness knee,
  1×1 GPU picking, label culling) were learned from reading skymap's source
  (MIT, © 2026 Alexander Rulkens). They were re-implemented, not copied.

## Status

Gaia DR4 is due 2026-12-02. The pipeline treats the Gaia release as a parameter, so DR4 can be
added once a distance catalogue exists for it. Not yet checked: Safari/Firefox, phones, and the
WebGL2 fallback for the slab and density modes.
