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
npm run synth        # optional: synthetic dev tiles -> ../data/tiles/synthetic-{stars,galaxies}
npm run dev          # http://localhost:5173
npm test             # vitest: tile parser, ICRS->Galactic, Planck18, fly-to path, Sesame parsing
npm run build        # tsc --noEmit + vite build -> dist/
npm run capture      # with the dev server up: screenshots at 1 pc / 300 pc / 30 kpc / 1 Gpc -> ../figures
```

`npm run synth` uses the repo's `.venv` (numpy and astropy, no scipy). It writes about 2.5 M
stars and 1.5 M galaxies. The data is synthetic and the viewer labels it that way.

### Tiles and the dev server

The Vite plugin in `vite.config.ts` serves `../data/tiles` at `/tiles` in `dev` and `preview`.
Tiles are not copied into `dist/`, because real tile sets are gigabytes. Missing files return a
real 404, not the SPA fallback. The plugin also answers `/tiles/_index.json` with the layers and
catalogues that are actually built, so the viewer never probes missing ones and the console
stays clean. On a static host, either serve the same `_index.json` next to the tiles, or accept
one 404 per layer that isn't built.

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
main.ts ── App: renderer init (WebGPU → WebGL2), frame loop, picking, info card, search, tour, deep links
 ├─ tiles/format.ts      contract parser: meta.json validation, 16-byte render/pick records, child bits
 ├─ tiles/streamer.ts    octree LOD: one max-heap over all layers by projected node size (px),
 │                       global point budget, children only after parent loaded, ≤6 fetches,
 │                       LRU eviction above 1.6 × budget, additive LOD (parent + children drawn)
 ├─ render/pointMaterial.ts  TSL PointsNodeMaterial on instanced quads (attributes inst, rgbl)
 ├─ render/brightness.ts     appearance model (shared by shader and CPU picker)
 ├─ render/post.ts           TSL RenderPipeline: half-float HDR → asinh stretch + Gaia sky sphere
 ├─ render/milkyway.ts       procedural MW model (Reid et al. 2019 arms), TSL sprites
 ├─ render/labels.ts         DOM labels, per-kind scale windows, greedy declutter, UI occluders
 ├─ nav/controller.ts        float64 orbit camera, cursor-anchored log zoom, WASD/QE, touch, flyTo
 ├─ math/frames.ts           ICRS→Galactic matrix (astropy-derived), l/b, RA/Dec, Hammer-Aitoff uv
 ├─ math/cosmology.ts        Planck18 comoving distance, lookback time, inverse
 ├─ math/flyto.ts            van Wijk–Nuij zoom/pan path in log space
 ├─ math/units.ts            AU/pc/kpc/Mpc/Gpc, light-travel time, 1-2-5 scale bar
 ├─ data/manifest.ts         layers.json, tiles/_index.json, catalogue loading + de-duplication
 ├─ data/resolve.ts          local catalogue search, CDS Sesame (CORS-checked mirrors), view distances
 └─ ui/rail.ts               "powers of ten" rail (log scale slider, 0.04 AU – 30 Gpc)
```

### Rendering rules (contract section 5)

- **Relative to eye.** The three.js camera stays at the origin and only rotates. The camera
  position is float64 in JS (`NavController.camPos()`). Each node mesh gets
  `position = centre − camPos` every frame, so `modelViewMatrix`, the per-node float32
  uniform, holds a small translation for nearby nodes. Points stay float32 relative to their
  node centre.
- **Depth.** `logarithmicDepthBuffer: true` is supported on `WebGPURenderer`; NodeMaterial
  writes `viewZToLogarithmicDepth`. Each frame `near` is set from the nearest drawn node
  (`min(0.5 × nearest, 1e-3 × D)`) and `far` from the farthest. Points are additive and don't
  depth-test, so log depth only matters for future opaque geometry.
- **LOD.** A node is refined when its bounding sphere projects larger than `minNodePx`, which
  the "Detail" slider sets. Nodes are taken in priority order until the point budget (default
  4 M, slider 0.5 to 12 M) is used up.
- **Brightness.** `M` comes from `lum`, then `m = M + 5 log10(r/10 pc)` from the camera, and
  `flux = 10^(−0.4 (m − mRef))`. Sprite size grows as flux^0.25 and peak intensity is divided by
  the area, so integrated light ∝ flux. Galaxies also get a physical radius (10 kpc at M = −21,
  ∝ L^0.3), so nearby ones resolve into constant-surface-brightness discs.
  `mRef = base + slope × log10(D)` is an auto-exposure (stars 6.0 + 0.9/decade, galaxies
  −16.5 + 3.9/decade) plus the user's Exposure slider. Light accumulates in half float and is
  compressed with an asinh stretch (Lupton et al. 1999).
- **Sky.** The Gaia DR3 integrated-flux image (Galactic Hammer–Aitoff, l = 0 at centre, l
  increasing to the left) is inverse-projected per fragment: direction → (l, b) → uv, with an
  explicit mip level so the l = ±180° seam doesn't show. It fades out between 1.5 and 2.5 kpc
  from the Sun. Credit: Gaia DR3 integrated flux (ESA/Gaia/DPAC).
- **Milky Way model.** Reid et al. 2019 (ApJ 885, 131), Table 2 log-periodic arms with kinks,
  extrapolated with a fade beyond the measured azimuth ranges. Also an exponential disc and a
  long bar (Wegg+ 2015). R0 = 8.275 kpc (GRAVITY 2021). It fades in beyond 1.5 kpc from the
  Sun. It is labelled as a model everywhere it appears.

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

`#v=x,y,z,D,yawDeg,pitchDeg` holds the focus (pc, Galactic), the camera–focus distance and the
orientation. It updates 0.4 s after the view settles; editing the hash flies there.

### Controls

Drag to orbit. Right-drag or Shift-drag to pan. Wheel or pinch zooms toward the cursor, about
1.25× per notch. W A S D fly and Q E move down/up, with speed proportional to scale and Shift
for 4×. Arrow keys orbit; + and − zoom. Click shows the brightest visible point under the cursor
(its `.ext.bin` is loaded on demand); double-click flies there. `/` focuses search.

## Known limits

- The deep link stores only the camera, not layer visibility or the selection.
- Picking runs on the CPU over drawn nodes inside the click ray, at a few ms for 1.6 M points.
  A GPU id buffer would scale better.
- With the dev data, labels from the real named-star catalogues don't coincide with synthetic
  points. That resolves once `stars-gaia` exists.
- The sky image also contains the stars inside 1 kpc that the point layer draws, so near the
  Sun those stars are counted twice. Toggle either layer to compare.
- The star colours in the synthetic generator use an approximate BP−RP → Teff → blackbody
  mapping (the Tanner Helland fit), not a calibrated one.
