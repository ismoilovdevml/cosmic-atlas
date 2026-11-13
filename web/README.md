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
node scripts/capture_solar.mjs ../figures http://localhost:5173/   # Solar System views -> figures/solar-*.png
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
- **Navigation.** The minimum camera distance is now 1e-11 pc (~300 km). Flying to a body locks
  the focus to it (it follows the body while time runs) and keeps the camera out of the planet.
- **For "Show me":** `observerGalacticXyz(lat, lon, h, date)` and `flyTargetForLatLon(lat, lon,
  date?, altitudeKm?)` in `src/solar/ephemeris.ts`. Tashkent matches astropy
  `EarthLocation→GCRS→Galactic` to 20 m.

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
    { "id": "gaia-sky", "type": "sky", "image": "sky/gaia_dr3_sky_l9.jpg", "credit": "..." } ] }
```

`colorMode` selects how the `lum` byte is decoded (contract section 3) and which sprite
profile is drawn: crisp round PSF for stars, soft random-axis ellipse for galaxies.

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
 ├─ render/labels.ts     DOM labels: scale windows, padded measured-box declutter, 300 ms fades
 ├─ state/hash.ts        deep-link format (view, layers, selection by stable id)
 ├─ tour/tours.ts        tours as data; targets resolved at playback
 ├─ nav/controller.ts    float64 orbit camera, cursor-anchored log zoom, WASD/QE, touch, flyTo
 ├─ math/*               frames (ICRS→Galactic, Hammer-Aitoff), Planck18, van Wijk–Nuij path, units
 ├─ data/manifest.ts     layers.json, tiles/_index.json, catalogues (dedup by name/alias, xyz may be null)
 ├─ data/resolve.ts      local search, CDS Sesame (CORS-checked mirrors)
 ├─ ui/rail.ts           "powers of ten" rail
 └─ solar/*              Solar System: ephemeris (astronomy-engine → contract frame), layer (bodies,
                         rings, orbits, probes), clock + time bar, info card rows, strings (tr)
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
  0.5–12 M) is used up.
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

### WebGPU landmines (skymap-lessons §2) and what applies here

| # | Landmine | Status |
|---|---|---|
| 1 | `writeBuffer` ordered against submit, not draws | Not hit: per-node data is in vertex buffers; the per-object uniforms (`onObjectUpdate`) get their own buffers from three.js; the blob buffer is written once per frame for one draw |
| 2, 13 | Invalid WGSL silently drops frames | Partly: three.js reports pipeline errors to the console, and the capture scripts fail on any console error. No WebKit check |
| 3 | Implicit-derivative sampling across seams | Avoided: the sky uses an explicit LOD |
| 6, 11 | Reversed-Z far plane, clip-w band | Not used (standard log depth). Clip w spans ~1e-7…3e9, inside the band |
| 15, 16 | Feature/limit requests, swap format | Handled by three.js |
| 17 | No sRGB encode on a `bgra8unorm` swap chain | **Fixed** by the explicit encode, verified by readback |
| 18 | Uncapped frames in flight | **Fixed**: cap of 2 |
| 19, 20 | Slot pools evicting their working set; stale rows | Only nodes fully faded out (alpha 0) and outside the cut are evicted; pick slots are freed on unload |
| 4, 5, 7–10, 12, 14 | Vertex-stage sampling, Adreno by-value structs, f32 cancellation, denormals, layout-auto bind groups, cubemaps, NaN bisects | Not applicable to our shaders, or handled by three.js's bind groups |

### Search

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

## Known limits and next steps

- **Next:** galaxy thumbnails (dot → ellipse → image ladder) through CDS hips2fits, which is
  CORS-safe for DSS. We'd use a 128² atlas with LRU and idempotent ready/failed sets (lessons §3
  #11). Not started.
- Galaxy layers are ordered by a seeded shuffle (contract §3), so the root is a random sample. At
  1 Gpc, most light comes from subtree blobs (soft glows) until the camera gets close enough to
  refine.
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
