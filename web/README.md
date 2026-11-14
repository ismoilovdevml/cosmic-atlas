# Cosmic Atlas: web viewer

A browser map of the universe from 1 AU to a few Gpc. It streams octree point tiles
(`data/tiles/<layer>/`, format in `../docs/data-contract.md` sections 3 to 5), with search,
labels, a Milky Way model and the Gaia all-sky image.

Rendering is **WebGPU-first** through three.js `three/webgpu` (`WebGPURenderer` with TSL node
materials). On browsers without WebGPU, three.js falls back to its WebGL2 backend from the
same code. The active backend is shown in the performance overlay. Append `?backend=webgl`
to the URL to force the fallback.

## Run

```bash
cd web
npm ci
npm run synth        # optional: synthetic raw tables -> pipeline/build_tiles.py -> ../data/tiles/synthetic-*
npm run dev          # http://localhost:5173
npm test             # vitest: tile parser (16/24 B ext), blob light conservation, photometry, deep links,
                     # tours, ICRS->Galactic, Planck18, fly-to path, Sesame parsing, Solar System
                     # ephemerides vs JPL Horizons, probe interpolation, Tashkent vs astropy, uz/ru search
npm run build        # tsc --noEmit + vite build -> dist/
npm run capture      # with the dev server up: screenshots at 1 pc / 300 pc / 30 kpc / 1 Gpc -> ../figures
node scripts/capture_galaxies.mjs  # M31, M33, M81, NGC 253 (EARTH=1: from the Sun; CAPTURE_EXTRA=1: LOD ladder)
node scripts/capture_solar.mjs ../figures http://localhost:5173/   # Solar System views -> figures/solar-*.png
# QA (dev server up; pass its URL as the last argument):
node scripts/qa_engines.mjs chromium|firefox|webkit <outdir> <prefix> ['?backend=webgl'] <url>  # views, slab, blobs, uncertainty, pick grid
node scripts/qa_compare.mjs a.png b.png ...    # pixel diff of screenshot pairs
node scripts/qa_mobile.mjs <outdir> <prefix> <url>   # 390x844 + 360x740 touch: layout, 44 px targets, contrast, gestures
node scripts/perf_budget.mjs 4,12 '' '#v=0,0,0,1e9,-150,28' <url> [--uncapped] [--detail=N]
node scripts/capture_blackholes.mjs ../figures 'http://localhost:5173/?gputime' 1  # black holes -> figures/bh-*.png, GPU ms
../.venv/bin/python -I scripts/measure_blackholes.py ../figures        # shadow radius vs Synge, disk asymmetry PA
node scripts/perf_firstpaint.mjs dist after --json=after.json   # first load of a build: fast / 1 MB/s / 0.3 MB/s (own server)
node scripts/plot_perf.mjs before.json after.json ../figures/perf-firstpaint.png
node scripts/capture_labels.mjs ../figures labels <url>        # GC from 5 / 7 kpc, Orion from 400 pc + label counts
../.venv/bin/python -I ../scripts/make_sky_variants.py public/sky/gaia_dr3_sky_l9.jpg   # sky preview + WebP
```

### Solar System (`src/solar/`)

- **Positions** come from astronomy-engine 2.1.19 (MIT) for the Sun, the 8 planets, Pluto, the
  Moon and the Galilean moons, at the simulation time (time bar: Now / pause / ×1, ×10⁴, ×10⁶;
  default = real time). Its J2000 equatorial vectors go through the ICRS→Galactic matrix of
  `math/frames.ts`. `test/ephemeris.test.ts` compares Earth, Mars, Jupiter and the Moon with JPL
  Horizons at J2000.0 and 2026-11-13 (worst 3.8e-5 of the Sun distance; Moon–Earth 12 km), and Io
  about Jupiter (130 km). Phobos and Deimos are not shown: astronomy-engine has no ephemeris for them.
- **Rendering.** True IAU mean radii, lit from the Sun's direction per fragment, with a minimum
  drawn radius (2.2 device px for planets, 1.6 for moons) so far bodies stay visible as dots.
  Bodies and their labels fade when they come within a few px of their parent. Planets are
  oriented with the IAU WGCCRE 2015 rotation model; the Earth by Greenwich sidereal time plus
  precession/nutation, so a latitude/longitude sits where it really is. Saturn's rings are lit
  with a Lommel–Seeliger law and carry the planet's shadow. Orbits are one period sampled from
  the ephemeris (2048 vertices for planets, 512 for moons), centred on the body; a line fades where
  its chords could show and when you zoom in on a single body.
- **Depth at sub-AU scale.** three.js clamps the log-depth near plane to ≥ 1e-6 scene units
  (0.2 AU in parsecs). The Solar System group is therefore scaled by 1e9 around the eye (a
  perspective projection ignores a uniform scale about the eye), which puts depth back into range
  down to metres; nothing else in the scene depth-tests. The post pass adds the Gaia sky only
  where the depth buffer is clear, so it does not show through planets. `figures/solar-moon-earth.png`
  (Earth 400,000 km behind the Moon, partly hidden by its limb) and `solar-saturn-rings-edge.png`
  (far half of the rings behind the disc, near half in front) are the checks.
- **Probes** (Voyager 1/2, Pioneer 10/11, New Horizons): `data/tiles/catalogs/spacecraft.json`
  (`scripts/build_spacecraft.py`), 30-day Horizons samples for 2000–2040, cubic Hermite in between
  (1–2 km off-grid in cruise; ~1.4 million km a day after New Horizons' 2007 Jupiter flyby, which
  30-day sampling cannot resolve). Drawn as markers with a faint trail since 2000.
- **Navigation.** The minimum camera distance is now 2e-13 pc (~6 km; it was 1e-11 pc, ~300 km). Flying to a body locks
  the focus to it (it follows the body while time runs) and keeps the camera out of the planet.
- **For "Show me":** `observerGalacticXyz(lat, lon, h, date)` and `flyTargetForLatLon(lat, lon,
  date?, altitudeKm?)` in `src/solar/ephemeris.ts`. Tashkent matches astropy
  `EarthLocation→GCRS→Galactic` to 20 m.

### Moon and Mars surfaces (`src/solar/surface/`, `src/solar/features.ts`)

Fly to the Moon or Mars and keep zooming: once the body's radius passes 160 device px, its single
global texture gives way to streamed tiles, down to 8 km above the ground (`SURFACE_MIN_ALT_KM`;
the global `MIN_DIST` is now 2e-13 pc ≈ 6 km).

- **Sources** (all `Access-Control-Allow-Origin: *`, checked 2026-11-14; licences and caveats in
  `docs/open-data-inventory.md`, "Planetary surfaces in use"): Moon LRO WAC mosaic v2 (levels 0–8,
  ~83 m/px) or LOLA colour-shaded relief; Mars Viking MDIM 2.1 colour (levels 0–7, ~325 m/px) plus
  the Murray Lab CTX mosaic (levels 5–12, ~5 m/px), or MOLA colour-shaded relief. The info card of
  the Moon, Mars or any of their features has a **Show relief / Show photo** switch.
- **Quadtree.** Patches follow the geographic tile pyramid (level 0 = 2 × 1 tiles of 180°). A patch
  splits while one tile texel covers more than 1.4 device px; patches beyond the horizon or outside
  the view are skipped (≤ 360 drawn). Each is a 33 × 33 grid plus a skirt, built in float64 relative to
  its own centre. While active the patches replace the body mesh and cover the whole sphere: a patch
  whose tile has not arrived samples its nearest loaded ancestor, or the global texture, through a
  sub-rectangle, and its own tile cross-fades in over 350 ms, so nothing pops or leaves a hole.
- **Requests.** `TileCache`: at most 6 fetches in flight, coarse levels and near tiles first, only
  for what is on screen this frame; LRU eviction at 192 MB of GPU texture; failed tiles retried twice.
- **Mars detail.** Viking gives the colour. Above level 5 the greyscale CTX tile modulates it by its
  local contrast (CTX ÷ the same mosaic three levels coarser); below ~60 km altitude CTX gradually
  sets the brightness itself (× 0.5, the measured Viking/CTX mean ratio) and Viking only the hue, so
  Viking's 232 m blotches do not dominate a 10 km view. CTX "no data" leaves the Viking colour alone.
- **Placement and light.** Vertices are placed with the same `bodyFrame()` as the body (IAU rotation
  model) and lit per fragment from the Sun like the body, so the terminator matches. `test/surface.test.ts`
  checks the transform against JPL Horizons sub-Earth and sub-solar points of the Moon (MOON_ME) and
  Mars (IAU_MARS) at J2000.0 and 2026-11-13: sub-Earth ≤ 0.0021° (≤ 60 m), sub-solar ≤ 0.0058°
  (≤ 0.34 km on Mars; Horizons applies the Sun's aberration and light time, we do not); Tycho, Apollo 11,
  Olympus Mons and Gale round-trip to 1e-9° and sit at the right great-circle distance from the
  sub-Earth point (≤ 0.0005°).
- **No elevation.** No DEM tile service with CORS exists for the Moon; the Mars MOLA DEM is only a
  HEALPix FITS pyramid (PADC). The surface is a sphere with flat imagery; mountains are only shading.
- **Names.** `scripts/build_planet_features.py` → `data/tiles/catalogs/planet-features.json`: 882
  entries (Moon 527 + Mars 340 IAU features, 5 Apollo LM sites, 10 Mars landers): per body the 300
  largest non-satellite features, plus Uzbek-labelled ones, Russian-labelled ones ≥ 80 km, a few
  famous small ones and every lunar "Statio". Labels turn with the body, show on the near side when
  ≥ 22 px, and open an info card (type, lat/lon, diameter, name origin). Search finds "Tixo", "Тихо",
  "Apollo 11", "Аполлон-11", "Curiosity", "Ulugʻbek". A followed focus on the surface turns with
  the body while time runs.
- **Captures.** `node scripts/capture_surface.mjs ../figures <url>` → `figures/surface-*.png`: Tycho,
  the Apollo 11 site, Olympus Mons and Gale, straight down from 3–4 altitudes each (screen centre =
  target, marked by a ring), at the first time from 2026-11-13 when the Sun is 20–45° up there.
  Measured 2026-11-14 (1440 × 900, DPR 1, M4 Pro, WebGPU):

  | view | requests | patches | deepest level | settle |
  |---|---|---|---|---|
  | Tycho 1500 / 300 / 60 km | 115 / 90 / 53 | 87 / 73 / 40 | 4 / 6 / 8 | 14 / 10 / 7 s |
  | Apollo 11 300 / 60 / 12 km | 77 / 44 / 0 | 57 / 32 / 6 | 6 / 8 / 8 | 8 / 7 / 2 s |
  | Olympus Mons 2500 / 800 / 150 km | 94 / 166 / 40 | 72 / 71 / 19 | 4 / 6 / 7 | 12 / 24 / 10 s |
  | Gale 800 / 200 / 30 / 12 km | 169 / 58 / 17 / 52 | 69 / 27 / 16 / 26 | 6 / 7 / 9 / 11 | 30 / 14 / 6 / 13 s |

  The whole run made 1,172 requests (81 MB); 23 CTX tiles failed after retries (HTTP 500 without CORS
  from the Esri cache, levels 10–11 around Gale and Olympus Mons). The WebGL 2 fallback draws the
  same Tycho views.
- **Two three.js r186 pitfalls** (comments in `surface.ts`): one Texture object in two texture nodes
  of one material while it compiles mixes up the bindings (every patch then showed its parent tile),
  so each node starts on its own 1 × 1 placeholder; and a mip-biased second sample of a texture
  another node also samples fails to compile (missing sampler), so the CTX low-pass is its ancestor tile.
- **Not done.** Elevation (above); Moon detail finer than WAC (Kaguya TC 7 m on Trek: JAXA terms not
  verified); Phobos and Deimos; Mercury, Venus and the outer moons (Trek / PADC HiPS exist); the
  camera can still be orbited below the local horizon at low altitude (the floor limits distance,
  not angle); deep links store the followed body, not the surface point.

### Black holes up close (`src/blackhole/`)

Fly toward any hole in `black-holes.json` (or press **Experience it** on its info card: a flight to
the Earth-side line of sight at 25 r_s with a disk, 40 r_s without) and the sky bends around it.

- **Scale.** r_s = 2GM/c² from the catalogue mass (IAU nominal GM☉): Sgr A* 1.269×10⁷ km, M87*
  1.92×10¹⁰ km, Gaia BH3 96.6 km. Near a hole the navigation floor drops to 1.5 r_s (it was 300 km);
  the camera stops there, on the photon sphere, with a message about the horizon. Camera–hole
  offsets are taken as (focus − hole) + offset in float64, so 1e-12 pc steps at 590 pc do not cancel.
- **Lensing** (`lens.ts`, `geodesic.ts` is its tested CPU twin). Per pixel, the orbit equation
  d²u/dφ² = −u + (3/2) r_s u² is integrated by RK4 in φ, starting from the static observer's
  u'(0) = −u₀√(1 − u₀) cot ψ (aberration included). Rays end captured (u = 1, or inward inside the
  photon sphere), on the disk, or escaped; outgoing rays beyond 10 r_s finish with an analytic
  tail (second order in u³/(w² − u²)), rays that never come within 200 r_s use the first-order
  orbit. The bent direction samples the Gaia sky image, the rendered frame where it lands inside
  it, and otherwise an environment cube of the scene captured from the hole (once a second).
  Background light is boosted by the static observer's blueshift g⁴ = (1 − r_s/r)⁻²; its colour
  is not shifted (the RGB images carry no spectra).
- **Disk** (on for Sgr A* and M87*, off for the dormant ones; HUD toggle). Thin, optically thick,
  from the ISCO (3 r_s) to 12 r_s, Novikov–Thorne flux (Page & Thorne 1974) → T ∝ F^¼, peak
  6500 K. Each hit gets g = √(1 − 1.5 r_s/r) / (√(1 − r_s/r_obs)(1 − Ω b_z)) (Luminet 1979; James
  et al. 2015) and is drawn as a blackbody at g·T (CIE 1931 → linear sRGB), which is exactly the
  redshifted spectrum, so I_bol ∝ g⁴. Orientation: M87* from its jet (i = 163°, PA 108° of the
  angular momentum; Walker et al. 2018, EHT 2019), Sgr A* from GRAVITY flare orbits (i = 154.9°,
  PA 177.3°; GRAVITY 2023). While the disk is on, the rest of the image is exposed ×0.15.
- **HUD**: distance in r_s and km; your clock and a far-away clock ticking at 1 : 1/√(1 − r_s/r);
  local escape speed c√(r_s/r); tidal stretch over 2 m, c² r_s L / r³ (= 2GML/r³), with a
  spaghettification warning above 10 g; thrust to hover GM/(r²√(1 − r_s/r)). **Flamm's paraboloid**
  z = 2√(r_s(r − r_s)) is drawn as an SVG overlay (a diagram, not lensed) inside ~200 r_s.
- **Quality / cost.** The lens runs only while a hole's Einstein radius √(2r_s/D) exceeds 2 device
  px. Ray steps per turn of φ: Low 48, Medium 96, High 160; on DPR ≥ 1.5 Low and Medium trace one
  ray per 2×2 device px and the compose stage filters the deflection with a status-masked bilinear
  (anti-aliased rims). GPU time per frame (timestamp queries, `?gputime`, M4 Pro, Sgr A* at
  10 r_s with the disk, whole frame): 1440×900 DPR 1: 6.75 ms without the lens, 7.62 ms Medium,
  8.45 ms High; DPR 2 (2880×1800): 9.60 ms without, 10.95 ms Medium, 17.29 ms High.
  WebGL 2 runs the same TSL shader compiled to GLSL (Low by default; checked on ANGLE/Metal only).
  `?bhlens=off` turns the lens off, `?bhq=low|medium|high` sets the quality.
- **Checks.** `test/blackhole.test.ts`: weak-field deflection vs 2r_s/b + (15π/16)(r_s/b)², the
  critical impact parameter (3√3/2) r_s, Darwin's strong-deflection limit, Synge's shadow radius
  from 1.2 to 50 r_s, the exit tail and far-ray shortcut vs fine integration, the disk image at
  80° vs a fine reference, NT flux, g at the ISCO, blackbody colours, and the shadow seen from
  Earth vs the EHT rings (Sgr A* 53.3 vs 51.8 ± 2.3 µas, M87* 39.7 vs 42 ± 3 µas).
  `scripts/capture_blackholes.mjs` writes `figures/bh-*.png`; `scripts/measure_blackholes.py`
  measures them: shadow radius 220.0 px vs Synge 219.8 px at 10 r_s, 55.8 vs 55.6 px at 40 r_s;
  M87* disk seen from Earth brightest at PA 195° (south; EHT 2017 images are brighter in the
  south), max/min 2.2.
- **Not modelled.** Kerr spin (Sgr A* and M87* spin; the shadow would shift and flatten by a few %),
  disk thickness and limb darkening, the real hot thick flows (EHT sees 230 GHz synchrotron, not a
  thin optical disk: the disk is illustrative, its temperature scale a display choice), light travel
  time, more than one lens at a time, the observer's own motion (you hover), lensing of labels and
  of the Flamm overlay. Points of the tile layers outside the main view are missing from the
  environment cube (the streamer culls by the main frustum). The camera cannot roll, so disks are
  not always horizontal on screen.

`npm run synth` uses the repo's `.venv` (numpy, astropy, pyarrow). It writes contract §2 Parquet
(`data/raw/synthetic-{stars,galaxies}/synthetic.parquet` + `PROVENANCE.json`, including
`dist_lo_pc`/`dist_hi_pc`), then runs `pipeline/build_tiles.py`, so there is one tile writer. It
produces about 2.5 M stars and 1.5 M galaxies. The data is synthetic, and the viewer labels it that
way. `synthetic-*` layers hide themselves once the real layer they stand in for (`fallbackFor`) exists.

### Tiles and the dev server

The Vite plugin in `vite.config.ts` serves `../data/tiles` at `/tiles` in `dev` and `preview`.
Tiles are not copied into `dist/`, because real tile sets are gigabytes. Missing files return a
real 404, not the SPA fallback. The plugin also answers `/tiles/_index.json` with the layers and
catalogues that are actually built, so the viewer never probes missing ones and the console
stays clean. On a static host, `../scripts/write_tiles_index.py <tiles>` writes the same file
(`make_lite_tiles.py` does it for you); without it you get one 404 per layer that isn't built.

The tile origin is configurable (`src/data/tilebase.ts`): `?tiles=<url>` > `VITE_TILE_BASE` >
`layers.json` `tilesBase` > `tiles/`. Paths in `layers.json` stay `tiles/...` and are re-rooted at
load. See the repo README, "Deploy".

### Layers manifest: `public/layers.json`

```jsonc
{ "catalogs": ["tiles/catalogs/named-stars.json", ...],          // contract section 4
  "layers": [
    { "id": "stars-gaia", "title": "Gaia DR3 stars", "path": "tiles/stars-gaia",
      "visible": true, "colorMode": "star" | "galaxy", "magOffset": 0, "credit": "..." },
    { "id": "synthetic-stars", ..., "dev": true, "fallbackFor": "stars-gaia" },  // hidden once the real layer exists
    { "id": "milky-way-model", "type": "milky-way-model", ... },
    { "id": "gaia-sky", "type": "sky", "image": "sky/gaia_dr3_sky_l9.jpg",       // JPEG: fallback
      "imageWebp": "sky/gaia_dr3_sky_l9.webp", "preview": "sky/gaia_dr3_sky_l9_lo.jpg", "credit": "..." } ] }
```

`colorMode` selects how the `lum` byte is decoded (contract section 3) and which sprite
profile is drawn: crisp round PSF for stars, soft random-axis ellipse for galaxies.

### First load

Only what the first frame needs is in the entry: the app (`index-*.js`), `three` (three/webgpu,
~0.9 MB of the ~1.2 MB, its own chunk so it stays cached across app releases) and `vendor`
(astronomy-engine). Dynamic imports, fetched later: the docs reader and markdown renderer (on the
first open), `docs/store.ts` (first info card), the black hole module (after the catalogues), the
HiPS cutout code (first galaxy thumbnail), the Show me tour (first click) and `window.__atlas`
(`debug/api.ts`, after the catalogues). Solar System textures are fetched per body once its true
radius passes 0.4 CSS px, so none at the default view. The layers panel lists every layer from
`layers.json` at once, each row in a loading state until its `meta.json` is in; metas and
catalogues load in parallel. The sky comes as a 1440×720 JPEG preview (190 KB), then, after the
metas and catalogues, the full image as WebP (2985 KB, 40.7 dB PSNR against the JPEG master), with
the JPEG (3666 KB) as fallback.

Measured 2026-11-14 with `scripts/perf_firstpaint.mjs` (production build served gzip-like GitHub
Pages, headless Chrome WebGPU, 1440×900, default view; medians of 3 runs local, 2 throttled):

| | local | 1 MB/s, 100 ms | 0.3 MB/s, 100 ms |
|---|---|---|---|
| first frame | 145 → 116 ms | 773 → 746 ms | 1839 → 1774 ms |
| layers panel lists the layers | 177 → 133 ms | 2364 → 852 ms | 6518 → 1888 ms |
| every layer meta in | 177 → 141 ms | 2364 → 1426 ms | 6518 → 4937 ms |
| first sky image | 169 → 138 ms | 25.5 → 2.8 s | 88.1 → 7.4 s |
| catalogues in | 261 → 204 ms | 8.0 → 5.3 s | 25.0 → 16.4 s |
| full sky image | 169 → 218 ms | 25.5 → 24.6 s | 88.1 → 83.6 s |

JS + CSS before the first frame: 1 file + CSS, 1,264 kB raw / 372 kB gzip → 5 files, 1,228 kB /
358 kB. Requests: 21 → 13 before the first frame; shell requests (all but tile `.bin` and
external hosts) 43 → 39, 7.09 → 4.90 MB. The full sky stays slow on a slow link because the tile
streamer's ~230 `.bin` requests (48 MB at the default view) share the bandwidth; DevTools
throttling shares it per request, not exactly as a real link does.

## Architecture

```
main.ts ── App: renderer init (WebGPU → WebGL2), on-demand frame loop with a frames-in-flight cap,
 │          info card + error bar, search, tour runner, deep links
 ├─ tiles/format.ts      contract parser: meta.json (incl. agg), 16-byte render records, pick records
 │                       with stride = meta.extBytesPerPoint (16 v1 / 24 with dist_lo, dist_hi), path lookup
 ├─ tiles/streamer.ts    octree cut: one max-heap over all layers by projected size, global point budget,
 │                       ≤6 fetches, LRU; own/blob fade channels; subtree blobs; pick slots; unc attributes
 ├─ tiles/blobs.ts       cut → blob frontier, own light = agg.L − Σ children (pure, unit-tested)
 ├─ render/brightness.ts photometry constants + CPU twin (solid-angle peak, rim-zeroed Gaussian, knee, sRGB)
 ├─ render/pointMaterial.ts  TSL: display / pick / uncertainty materials per layer + blob material
 ├─ render/pick.ts       GPU picking: 1×1 cropped projection into RGBA32F, one pick in flight
 ├─ render/post.ts       TSL RenderPipeline: linear HDR → asinh → explicit sRGB encode; Gaia sky sphere
 ├─ render/milkyway.ts   procedural MW model (Reid et al. 2019 arms), TSL sprites
 ├─ render/labels.ts     DOM labels: scale windows, padded measured-box declutter, 300 ms fades, per-kind
 │                       caps, importance-scaled spacing, context-first, "12 pulsars" badges (unit-tested)
 ├─ render/galaxyShapes.ts  resolved nearby galaxies: dot → oriented disk → DSS thumbnail (TSL, ≤16 slots)
 ├─ render/galaxyGeom.ts    LOD weights, disk axes from PA + inclination, profiles (pure, unit-tested)
 ├─ render/galaxyMask.ts    shared dot-weight mask applied to galaxy tile points (TSL Loop)
 ├─ data/hipsCutout.ts      hips2fits request + in-browser HEALPix reprojection from CORS HiPS mirrors
 ├─ state/hash.ts        deep-link format (view, layers, selection by stable id)
 ├─ tour/tours.ts        tours as data; targets resolved at playback
 ├─ nav/controller.ts    float64 orbit camera, cursor-anchored log zoom, WASD/QE, touch, flyTo
 ├─ math/*               frames (ICRS→Galactic, Hammer-Aitoff), Planck18, van Wijk–Nuij path, units
 ├─ data/manifest.ts     layers.json, tiles/_index.json, catalogues (dedup by name/alias, xyz may be null)
 ├─ data/resolve.ts      local search, CDS Sesame (CORS-checked mirrors)
 ├─ ui/rail.ts           "powers of ten" rail
 ├─ solar/*              Solar System: ephemeris (astronomy-engine → contract frame), layer (bodies,
 │                       rings, orbits, probes), clock + time bar, info card rows, strings (tr)
 └─ blackhole/*          black holes up close: geodesic (CPU twin), lens (TSL trace RTT + compose in
                         PostPass), physics, blackbody table, catalogue → r_s and disk axis, HUD +
                         Flamm overlay, strings (tr, bh.*)
```

### Rendering rules (contract section 5, plus what we took from skymap)

Several techniques are adapted from skymap (github.com/rulkens/skymap, MIT, Copyright (c) 2026
Alexander Rulkens). They are re-implemented in three.js/TSL, and no code is copied. See
`../docs/skymap-lessons.md` for the references.

- **Relative to eye.** The three.js camera stays at the origin and only rotates. The camera
  position is float64 (`NavController.camPos()`). Each node mesh gets `position = centre − camPos`
  every frame, so `modelViewMatrix`, the per-node float32 uniform, carries a small translation for
  nearby nodes. Blob centroids are also subtracted in float64 and narrowed after.
- **Depth.** `logarithmicDepthBuffer: true` (NodeMaterial writes `viewZToLogarithmicDepth`).
  Near and far adapt to the nearest and farthest drawn node. Additive content does not depth-test.
- **LOD and budget.** A node refines when its bounding sphere projects larger than `minNodePx` (the
  Detail slider). Nodes are taken in priority order until the point budget (default 4 M, slider
  0.5–12 M) is used up. Measured at 1 Gpc with DESI on an Apple M4 Pro (Chromium, WebGPU, 1440×900,
  `scripts/perf_budget.mjs`): 4 M draws 4.02 M points at 60 FPS with vsync (65–68 FPS, 14.7–15.4 ms
  uncapped); 12 M draws at most 6.05 M at this view (the cut runs out of nodes worth refining, also
  at Detail 400) at 35–41 FPS mean, 24.6–28.6 ms per frame, worst 1 s sample 28.7 FPS. The main
  thread is 75 % idle at 12 M, so it is GPU-bound. 4 M stays the default; above about 6 M at 1 Gpc
  expect 30–40 FPS on this class of GPU.
- **Subtree blobs, honest version.** A blob may only stand in for light that is unresolved at the
  current view. A subtree that is not drawn becomes a blob only when twice its light-weighted RMS
  radius projects to at most `blobMaxPx` = 6 device px. The sprite radius is 1.63 × RMS, so its 2D
  RMS matches the subtree's projected RMS.
  - A larger subtree is never smeared. It is queued for loading in priority order, and if the point
    budget does not reach it, its light is reported as **pending** in the overlay (for example
    "Light pending: DESI 81 %" at 1 Gpc with the default 4 M budget).
  - Flux-mode subtrees whose combined light would be invisible anyway are neither loaded nor
    reported pending.
  - Layer roots are always drawn, so a small layer is never starved by a big one.
  - The overlay's "Light kept (unresolved)" is (drawn + blob) / (root − pending), 100.0 % at every
    scale. `test/blobs.test.ts` checks drawn + blob + pending = root, and that blobs never cover
    resolvable light, on the tiles on disk including the 15 M DESI tiles.
  - **RMS radius:** the tiles' `agg` has no RMS radius yet. The viewer reads `agg.rms` when present,
    and otherwise uses the RMS of a uniformly filled cube about its centre, which is the half-edge.
    *Proposed contract field:* `rms = sqrt(Σ L·|x − c|² / Σ L)` per subtree. It can be merged from
    child moments (Σ L, Σ L·x, Σ L·|x|²) in `pipeline/build_tiles.py`.
- **Galaxies at survey scales (density mode).** Between 10 and 40 Mpc of camera distance, galaxy
  layers blend from flux photometry to a fixed 2.2 CSS-px sprite.
  - **Exposure:** every few frames the app projects a strided sample of up to 150 k drawn galaxy
    points into a 48×30 screen grid and finds the 98th-percentile bin count. It then sets the
    per-galaxy peak so that this bin's mean luminance hits the target
    (`k = T·binArea/(p98·K·r²)`, `src/render/exposure.ts`, unit-tested), smoothed in log space.
    The dense z < 0.4 BGS core does not saturate, and a floor keeps a lone galaxy faintly visible.
  - Apparently bright galaxies get up to a 2.5× boost.
  - Blobs in this mode carry galaxy counts (`agg.n`), not light.
- **Thin slab** (Display → Thin slab, ±10–300 Mpc, also in the deep link as `slab=`). Only points
  and blobs within ± the half-thickness of a plane through the focus, facing the viewer, are drawn,
  with a soft edge. The exposure estimate uses the same slab. This is the standard way to show the
  cosmic web (CfA slice, SDSS and DESI wedges; DESI DR1 Fig. 1 is a ±5° declination wedge).
  Checked on real DESI: `figures/viewer-200Mpc-slab.png` (±25 Mpc) shows filaments and voids, and
  `figures/viewer-1Gpc-slab.png` (±75 Mpc) shows the survey wedge.
- **Fades.** Each node has an own-points channel and a blob channel, which walk linearly toward
  their targets at one rate (0.35 s). During a split, the parent's blob fades out while its points
  and its children's blobs fade in, so the light stays constant.
- **Photometry.** `flux = 10^(−0.4 (m − mRef))`, where `m` is computed from the lum-code M and the
  distance from the camera. Light is deposited **per unit solid angle**: the sprite radius is
  converted to a reference of 935.3 px/rad before the peak is computed, so canvas size, pixel ratio
  and field of view do not change brightness. The sprite is a rim-zeroed Gaussian
  `(e^{−4u²} − e^{−4})/(1 − e^{−4})` with exact integral `K = 0.7268`. The glow grows as flux^¼,
  only the drawn size is capped, and the peak comes from the uncapped size. A hue-preserving knee
  `8(1 − e^{−I/8})` is applied before the colour tint. Galaxies also get a physical radius.
  `mRef` = auto-exposure (stars 5.5 + 0.9/decade, galaxies −20.5 + 3.9/decade of camera distance)
  + the Exposure slider.
- **Colour pipeline.** sRGB bytes are decoded to linear in the shaders and summed in a half-float
  target. That is tone-mapped with an asinh stretch (Lupton et al. 1999), then encoded explicitly
  to sRGB, then dithered by ±½ LSB. The sky JPEG is decoded by the texture (`SRGBColorSpace`). The
  canvas is a non-sRGB 8-bit format and `outputColorTransform` is off, so there is exactly one
  encode. *Verified:* with every layer off, the canvas reads back (4, 6, 11), the CSS `--void`, on
  both WebGPU and WebGL2. This is skymap's open "no sRGB encode" backlog item, closed for us.
- **GPU picking.** `camera.setViewOffset(W, H, x, y, 1, 1)` rasterises only the cursor pixel into a
  1×1 RGBA32F target holding (point index, node slot, layer code). Floats are exact below 2^24 and
  avoid integer-target differences between backends. The brightest point wins through
  depth = 1/(1+I). One pick is in flight at a time. The pick uses the same intensity as drawing, so
  nothing invisible can be clicked. Minimum footprint is 3.5 px.
- **Distance uncertainty.**
  - The info card shows the median distance, its 16–84 % range and the fractional error, for tile
    points (from the 24 B ext record) and catalogue entries that have `dist_lo_pc`/`dist_hi_pc`.
  - The selected object gets a line-of-sight error bar from dist_lo to dist_hi. The bar is
    projected from 3D each frame into an SVG overlay, and is dashed when there is no upper bound.
  - Display → *Distance uncertainty* turns the points of the 32 most important drawn nodes (those
    whose ext data is loaded) into quads stretched along the Sun→point line. Their peak is scaled
    by w/(len+w) so their light is conserved.
- **Frame hygiene.** The app renders on demand: the GPU is only used when the view, data, a fade, a
  flight or a setting changes. Frames in flight are capped at 2 with
  `device.queue.onSubmittedWorkDone()`, against skymap's measured 7-deep queue and 69 ms of
  latency. DPR is capped at 2. The overlay's FPS reads "idle" when nothing renders; the capture
  script measures FPS with `__atlas.setContinuous(true)`.
- **Sky.** The Gaia DR3 integrated-flux image (Galactic Hammer–Aitoff) is inverse-projected per
  fragment with an explicit mip level (`textureSampleLevel`-style, no seam). It fades out between
  1.5 and 2.5 kpc from the Sun. Credit: Gaia DR3 integrated flux (ESA/Gaia/DPAC).
- **Milky Way model.** Reid et al. 2019 Table 2 arms with R0 = 8.275 kpc (GRAVITY 2021), plus an
  exponential disc and a long bar. It is labelled as a model wherever it appears.
- **Resolved nearby galaxies** (`render/galaxyShapes.ts`, data from `../scripts/build_galaxy_shapes.py`,
  format in `../docs/data-contract.md` §4b). Galaxies of the local-group, local-volume and
  messier-ngc catalogues that have a D25 size become more than a dot when they are large on
  screen. The ladder follows skymap's (MIT, re-implemented):
  - **LOD** by projected D25 diameter: 8→14 CSS px dot → procedural disk, 24→40 px disk → thumbnail
    once its image has arrived (plus a 0.35 s fade-in). The weights are smoothsteps with
    dot + disk + thumbnail = 1 exactly (`test/galaxyGeom.test.ts`). The "dot" is the galaxy's own
    tile point(s) in every galaxy layer: a shared mask (`galaxyMask.ts`) dims points within
    max(1′, 5 % of the D25 radius) of the galaxy's direction from the Sun and within ±40 % of its
    distance, so satellites such as M32 keep their dots. At most 16 galaxies are resolved at once
    (largest first); the rest stay dots.
  - **Geometry.** A disk is a thin plane through the catalogue position, sized from D25 at the
    catalogue distance, its major axis along the PA on the sky and tilted by the inclination about
    it (`diskAxes`). The tilt is the catalogue inclination, but never beyond cos = 0.85 b/a, so a
    thin sheet still covers the isophote of edge-on disks (NGC 253: 90° → 81.6°). Which side of a
    disk is near is not known; one is picked. Disks get a small camera-facing bulge (fraction by
    T type). E/dE/dSph systems (`shape: spheroid`) are a camera-facing ellipse with the catalogue
    axis ratio, its major axis along the projected sky major axis.
  - **Thumbnails are images seen from Earth.** They are shown as billboards on that same plane (or
    ellipse), oriented by PA and inclination: each plane point samples the cutout at its sky offset
    as seen from the Sun. From the Sun this is the real sky at the right size and orientation
    (`../figures/galaxy-*-vs-dss.png`). Seen from elsewhere it is the Earth view tilted with the
    disk, so it is approximate, and more so the farther the camera is from the Sun–galaxy line:
    satellites and foreground stars in the image are painted onto the disk
    (`../figures/galaxy-m31-oblique.png`) and the bulge is flat.
  - **Image source.** A 512² north-up TAN cutout of the DSS2 colour HiPS (CDS/P/DSS2/color), field
    1.5 × the major axis, from CDS hips2fits (ACAO `*`). If hips2fits fails (HTTP error or CORS
    block), the viewer skips it for 10 minutes and reprojects the same HiPS in the browser from the
    tiles of CORS-enabled mirrors (IRSA, then ESA Sky): HEALPix NESTED, cell (ix, iy) of order k+9
    at tile column `iy & 511`, row-from-top `ix & 511`, checked against Legacy Surveys cutouts in the
    north cap, the equatorial zone and the south cap. If that fails too, the procedural disk stays
    (`?thumbs=off` forces this). At most 2 fetches at a time, only for the 6 largest galaxies above
    20 px, an LRU of 12 textures, and ready/failed sets so nothing is retried in a loop. On
    2026-11-13 hips2fits answered 404 ("page unavailable") from the build host, so the captures
    used the IRSA path.
  - **Light.** At the dot→disk crossfade the disk carries the dot's flux (same photometry as the
    points). Beyond that, the point auto-exposure would make every resolved galaxy invisible (its
    surface brightness is fixed, the exposure is not), so between 14 and 80 px the mean intensity
    over D25 ramps in log space to a display level set by the galaxy's mean surface brightness
    (0.12 at μ = 22 mag/arcsec², the Exposure slider applies). The thumbnail is normalised to the
    same mean over D25 after subtracting the median of its border, and masked softly outside
    1.0–1.45 × the D25 ellipse.
  - **Info card.** D25 size in kpc and arcmin, morphology (type and T), inclination and PA with
    their sources, and the image credit (DSS: STScI/NASA; colour HiPS: CDS), saying whether the
    image came from hips2fits or a mirror. A click on a drawn disk opens it (CPU test against the
    projected D25 ellipse, because the GPU pick cannot see the dimmed points).

### WebGPU landmines (skymap-lessons §2) and what applies here

| # | Landmine | Status |
|---|---|---|
| 1 | `writeBuffer` ordered against submit, not draws | Not hit: per-node data is in vertex buffers; the per-object uniforms (`onObjectUpdate`) get their own buffers from three.js; the blob buffer is written once per frame for one draw |
| 2, 13 | Invalid WGSL silently drops frames | Partly: three.js reports pipeline errors to the console, and the capture scripts fail on any console error. Checked on Chromium (WebGPU, WebGL2), WebKit 27.2 (WebGPU, WebGL2) and Firefox 157 (WebGL2: no WebGPU adapter headless, clean fallback): no errors, identical pick results |
| 3 | Implicit-derivative sampling across seams | Avoided: the sky uses an explicit LOD |
| 6, 11 | Reversed-Z far plane, clip-w band | Not used (standard log depth). Clip w spans ~1e-7…3e9, inside the band |
| 15, 16 | Feature/limit requests, swap format | Handled by three.js |
| 17 | No sRGB encode on a `bgra8unorm` swap chain | **Fixed** by the explicit encode, verified by readback |
| 18 | Uncapped frames in flight | **Fixed**: cap of 2 |
| 19, 20 | Slot pools evicting their working set; stale rows | Only nodes fully faded out (alpha 0) and outside the cut are evicted; pick slots are freed on unload |
| 4, 5, 7–10, 12, 14 | Vertex-stage sampling, Adreno by-value structs, f32 cancellation, denormals, layout-auto bind groups, cubemaps, NaN bisects | Not applicable to our shaders, or handled by three.js's bind groups |

### Languages and the docs reader

- **UI in uz / en / ru** (`src/i18n/`): `t(key, vars)` with ICU-style plurals (`{n, plural, one {…} other {…}}`),
  `setLang()`, `onLangChange()`. Language: `?lang=` > saved choice > browser > `uz`. The UZ · EN · RU switch
  in the top bar re-renders panels, card, rail, tour caption and labels without reloading. Static page
  text uses `data-i18n` / `data-i18n-attr` attributes in `index.html`. Unit abbreviations and number format:
  `../docs/content-contract.md` §1.
- **Uzbek apostrophe:** IBM Plex Sans draws U+02BB 0.6 em wide ("yo ʻ li"), so `src/ui/okina.ts` takes
  just U+02BB/U+02BC from the bundled Spectral file through a `unicode-range` font face.
- **Docs reader** (`src/docs/`, `#doc=<slug>`): fetches `public/docs/<lang>/<slug>.md`, parses front matter,
  renders Markdown with a small renderer that escapes all source text and emits a fixed tag set (raw HTML
  in a file is shown as text, `javascript:`/`data:` URLs are dropped). `doc:` links open articles,
  `#focus=` / `#layer=` links drive the map. Missing in the current language → English with a notice.
  Placeholders carry `placeholder: true` and say so in the reader.
- **Info card**: the article `summary` under the title and a "Learn more" button, for tile points (layer
  kind), catalogue entries (`docs` or kind), named views and Sesame results (SIMBAD type → kind).
- Visual check, dev server running: `node scripts/capture_i18n.mjs ../figures <devUrl>` captures
  `figures/i18n-*.png` and audits each for page overflow, clipped text and contrast below 4.5:1.

### Search

Typed names in any of the three languages go through `src/search/aliases.ts` first: Solar System bodies
("Yer", "Earth", "Земля"), named views (Milky Way, Local Group, Laniakea, DESI footprint …, cameras reused
from the tour where one exists) and kind words ("qora tuynuk", "black holes", "чёрные дыры" list the
matching objects plus the article). Folding ignores case, diacritics and the Uzbek apostrophe variants and
transliterates Cyrillic, so "Сомон йўли", "Somon yoli" and "Somon yoʻli" are one key; up to 1–2 typos are
tolerated. The Solar System module registers live bodies with `window.__atlasBodies(provider)`.

Local catalogues (contract section 4) are searched instantly, matching names and aliases while
ignoring case and spaces. Duplicates across catalogues are merged by any shared name or alias
(`MESSIER031` matches `M31`). Anything else goes to CDS Sesame.
`cds.unistra.fr/cgi-bin/nph-sesame` redirects to `vizier.idia.ac.za` and the redirect response
carries no `Access-Control-Allow-Origin`, so browsers block it. The viewer therefore queries
`vizier.cfa.harvard.edu/viz-bin/nph-sesame` (ACAO `*`, verified from the browser) and falls
back to the IDIA mirror. Distances use parallax when SNR ≥ 5 and the object isn't a galaxy;
otherwise redshift via Planck18 comoving distance when z ≥ 0.003. Otherwise the result is
"direction only": the view turns toward the object from the Sun and says so.

### Deep links

`#v=x,y,z,D,yawDeg,pitchDeg&l=<id>,~<hidden id>&slab=<half Mpc>&sel=<layer>:<id>@x,y,z` (or `sel=cat:<name>`).
The selection is stored as a **stable catalogue id** plus its position. On load, the viewer walks
the octree path to that position, finds the id in those nodes' `.ext.bin` files and opens the card.
A rebuilt tile set keeps working, unlike skymap's record-index links. Round-1 links (`#v=` only)
still work.

### Tours

Tours are plain data (`src/tour/tours.ts`): beats with durable targets (the Sun, the Galactic
Centre, catalogue names with a fallback position, or a point between two targets), a distance, a
caption and a dwell time. Targets are resolved when the tour plays. The runner snapshots the camera,
layer visibility and selection. A beat can turn on the layers it needs. Stop or the end of the tour
restores the scene and flies back; any user input stops it without flying back.

### Controls

Drag to orbit. Right-drag or Shift-drag to pan. Wheel or pinch zooms toward the cursor, about
1.25× per notch. W A S D fly and Q E move down/up, with speed proportional to scale and Shift
for 4×. Arrow keys orbit; + and − zoom. Click shows the brightest visible point under the cursor
(its `.ext.bin` is loaded on demand); double-click flies there. `/` focuses search.

### Cross-engine QA (2026-11-14)

`scripts/qa_engines.mjs` on the same deep links, compared with `scripts/qa_compare.mjs` against
Chromium/WebGPU. Chromium WebGL2 matches to ≤ 0.23/255 mean per channel at every view (slab,
density exposure, blobs, uncertainty included). WebKit (both backends) and Firefox match to
1.3–2.4/255 with mean luminance within 0.06/255; the residue is text and point-raster
antialiasing. The 54-point GPU pick grid gives the same 46 ids on all five engine/backend
combinations. Two bugs were found and fixed: the sky was point-sampled on WebGPU only (placeholder
texture's sampler), and the distance-uncertainty streaks were back-face culled on every backend
(mirrored quad basis, see `src/render/streak.ts`). Figures: `../figures/qa-*.png`.

## Known limits and next steps

- Galaxy thumbnails are DSS2 only (all-sky, photographic, saturated cores). A deeper colour HiPS
  (Legacy Surveys DR10, Pan-STARRS) where it covers the galaxy is not wired up. Galaxies without
  a D25 size in galaxy-shapes.json (10 of 1016) and all 2MRS/CF4/DESI-only galaxies stay dots.
- Above 14 px the resolved-galaxy brightness is a display choice, not photometry. The dot→disk
  handover is photometric, but the catalogue magnitude (V or B) can differ from the tile's band.
- Galaxy layers are ordered by a seeded shuffle (contract §3), so the root is a random sample. At
  1 Gpc, most light comes from subtree blobs (soft glows) until the camera gets close enough to
  refine.
- Uncertainty streaks are not yet exactly light-conserving: a near-zero-length streak is a square
  quad with a Gaussian across and tapered ends, not the round sprite, and the 300 pc test view gets
  about 7 % brighter (mean frame luminance 47.0 → 50.2/255) when the mode is switched on.
- Uncertainty streaks only appear for the 32 most important drawn nodes (ext data must be loaded),
  as a cost cap.
- Picking uses float encoding: point index < 2^24, node slots < 2^22. Leaf nodes above
  `nodeCapacity` (build depth cap) are still within range.
- Catalogue entries with `xyz: null` are searchable and turn the view toward their direction, but
  have no label.
- With the dev data, labels from the real named-star catalogues do not sit on synthetic points.
- Labels of extended objects (galaxies, Milky Way entries, model features, clusters) hide when the
  object projects to less than 1 px. Stars are points and keep their labels.
- At 1 Gpc without the slab, a full-depth projection is inherently crowded, and the high-z
  LRG/ELG fan shows as a dense violet region. Use the slab to read the web.
- The sky image also contains the stars inside 1 kpc, so near the Sun those stars appear twice.
