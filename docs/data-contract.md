# Data contract (v1)

Single source of truth for everything that flows between the fetch scripts, the tile builder
and the web viewer. Change it here first, then in code.

## 1. Frame and units

- **Frame:** heliocentric Galactic Cartesian (astropy `Galactic`), origin = Sun.
  - `+x` toward the Galactic Centre (l=0, b=0), `+y` toward l=90 (rotation direction), `+z` toward the NGP.
- **Unit:** parsec everywhere in tiles (galaxies too: 1 Mpc = 1e6 pc). No per-layer units in the renderer.
- **Distances for galaxies:** comoving distance from redshift with astropy `Planck18`
  (for z < 0.003 use the catalogue's redshift-independent distance when one exists, never Hubble-flow).

## 2. Raw layer tables (`data/raw/<layer>/*.parquet`, gitignored)

Each fetch script writes Parquet with **at least** these columns:

| column | type | meaning |
|---|---|---|
| `id` | string | stable catalogue id, e.g. `Gaia DR3 4472832130942575872`, `DESI 39627...` |
| `ra`, `dec` | float64 | ICRS degrees, epoch of the catalogue |
| `dist_pc` | float64 | best distance estimate (pc) |
| `dist_lo_pc`, `dist_hi_pc` | float64 | 16th / 84th percentile (NaN if unknown) |
| `mag` | float32 | apparent magnitude in the layer's band (Gaia G, DESI r, V for named objects) |
| `color` | float32 | colour index (Gaia BP-RP) or NaN |
| `kind` | string (category) | `star`, `wd`, `galaxy`, `qso`, `lg_galaxy`, ... |

Layer-specific extra columns are allowed (e.g. `z`, `zerr`, `spectype`, `ruwe`).
Every fetch script also writes `data/raw/<layer>/PROVENANCE.json`: query text, service URL,
UTC time, row count, cuts, and citation (paper + DOI).

## 3. Tile layout (`data/tiles/<layer>/`, produced by `pipeline/build_tiles.py`)

```
data/tiles/<layer>/meta.json
data/tiles/<layer>/n/<node>.bin      # render records, always loaded for visible nodes
data/tiles/<layer>/n/<node>.ext.bin  # pick records, loaded only on click/hover
data/tiles/<layer>/n/<node>.vel.bin  # optional velocities, loaded only while the time slider is off "now"
```

Octree, Potree-style naming: root `r`, children `r0`..`r7`, grandchildren `r00`.. etc.
Child index bits: `(x>=cx)<<2 | (y>=cy)<<1 | (z>=cz)`.
Each node keeps at most `nodeCapacity` points (default 20 000). Points are **ordered by importance
before insertion** — stars by luminosity (brightest first, so the root holds what a distant observer
would see), galaxies by a seeded random shuffle (so every LOD level is an unbiased sample of the
cosmic web) — and deeper nodes add the rest: rendering a node never requires its parent to be hidden
(additive LOD, parent + children both drawn).

### meta.json

```json
{
  "layer": "stars-gaia",
  "title": "Gaia DR3 stars within 1 kpc",
  "unit": "pc",
  "frame": "galactic-helio",
  "count": 12345678,
  "nodeCapacity": 20000,
  "record": "xyz_f32_rgb_u8_lum_u8",
  "bytesPerPoint": 16,
  "extRecord": "id_u64_mag_f32_color_f32_distlo_f32_disthi_f32",
  "extBytesPerPoint": 24,
  "idPrefix": "Gaia DR3 ",
  "nodes": [
    {"name": "r", "center": [0,0,0], "half": 1000.0, "count": 20000, "children": 255,
     "agg": {"n": 12345678, "L": 3.1e7, "c": [12.0, -3.5, 1.2], "rgb": [255, 236, 214], "rms": 410.2}}
  ]
}
```

- `center` is float64 (JSON number) in pc, `half` = half edge length of the cube.
- `children` = 8-bit mask of existing children.
- `agg` = summed light of the node **and all its descendants**: point count `n`, total luminosity `L`
  (units of an M=0 source, recovered from the `lum` codes), light-weighted centroid `c` (pc, relative to
  `center`), light-weighted mean `rgb` and light-weighted RMS radius `rms` (pc). The renderer draws one soft "blob" per unloaded subtree so
  distant views keep their total light (technique from skymap, MIT).

### `.bin` render record — 16 bytes, little endian

| offset | type | field |
|---|---|---|
| 0 | float32 ×3 | x, y, z **relative to node center**, pc |
| 12 | uint8 ×3 | r, g, b (sRGB, from BP-RP via blackbody/Teff map for stars; redshift ramp for galaxies) |
| 15 | uint8 | `lum` = brightness code: `clamp(round((20 - M) * 10), 0, 255)` for stars (M = G - DM(d), no extinction), `clamp(round((-14 - M) * 20), 0, 255)` for galaxies with M = m - DM(d_L), d_L = (1+z) d_C, no K-correction. A rendering proxy, never shown as a science absolute magnitude. |

### `.ext.bin` pick record — 24 bytes, little endian, same point order

| offset | type | field |
|---|---|---|
| 0 | uint64 | numeric catalogue id (Gaia `source_id`, DESI `targetid`); string id = `idPrefix + id` |
| 8 | float32 | apparent `mag` |
| 12 | float32 | `color` (BP-RP) or redshift `z` for galaxies |
| 16 | float32 | `dist_lo` — 16th percentile distance, pc (NaN if unknown) |
| 20 | float32 | `dist_hi` — 84th percentile distance, pc (NaN if unknown) |

### `.vel.bin` velocity record — optional, 8 bytes, little endian, same point order

Written by `build_tiles.py --velocity helio|lsr` (default `auto` = `helio` when the raw table has
`pmra`/`pmdec`). Layers without it keep working: the viewer only reads this stream when
`meta.velocity` exists, and only for drawn nodes while the time slider is away from "now".

| offset | type | field |
|---|---|---|
| 0 | float16 ×3 | `vx, vy, vz` — space velocity, **km/s**, contract Galactic axes (§1) |
| 6 | float16 | `q` — what is known: `1` = full 3D (proper motion + distance + radial velocity), `0` = no radial velocity: only the tangential part is stored (the line-of-sight motion is unknown, the viewer fades these points as \|Δt\| grows), `-1` = no proper motion either (stored as 0, the point stays put) |

- Conversion (vectorised numpy, `space_velocity_galactic`): `v_icrs = k·d·(pmra·ê_α + pmdec·ê_δ) + rv·r̂`,
  `v_gal = M @ v_icrs` with the §4 matrix, `k = 4.740470463533349e-3` km/s per (mas/yr · pc)
  (`(1 mas/yr · 1 pc).to(km/s, dimensionless_angles())`, astropy), `pmra` = μ_α* (Gaia convention),
  `d` = the same `dist_pc` as the position (r_med_geo for Gaia). Checked against
  `SkyCoord(...).galactic.velocity` and `GalacticLSR` to < 1e-9 relative in `tests/test_build_tiles.py`.
- Why float16 ×4 rather than ×3: the 4th slot carries `q`, and 8 B keeps every record 4-byte
  aligned. float16 keeps 11 significant bits: relative error ≤ 2⁻¹¹ (0.05 %) per component, e.g.
  ±0.004 km/s at 14 km/s → ±0.004 pc per Myr. For Gliese 710 this moves the predicted closest
  approach from 0.0512 pc (float64) to 0.0533 pc (tile), well inside the literature scatter.
- Frame origin: `helio` (default) = relative to the Sun, so the Sun stays at the origin and
  `x(t) = x0 + v·t` is the position relative to the Sun. `lsr` = relative to the Local Standard of
  Rest: the Sun's own motion (U, V, W)⊙ = (11.1, 12.24, 7.25) km/s (Schönrich, Binney & Dehnen 2010,
  MNRAS 403, 1829; astropy `GalacticLSR` default) is added to every point and stored as
  `meta.velocity.sunVelocity`. Gaia velocities are barycentric; Sun − barycentre (~0.01 km/s) is ignored.
- 1 km/s for 1 Myr = 1.022712 pc (`pcPerKmsMyr`, Julian years).

`meta.json` gains, only when the stream is written:

```json
"velocity": {"unit": "km/s", "frame": "galactic", "origin": "sun", "encoding": "vx_vy_vz_q_f16",
             "bytesPerPoint": 8, "rvMissing": "tangential", "q": {"full": 1, "tangential": 0, "none": -1},
             "sunVelocity": [0, 0, 0], "sunVelocityRef": null,
             "counts": {"full": 34313, "tangential": 29827, "none": 0}, "pcPerKmsMyr": 1.022712165045695}
```

and every node a `vmax` (km/s, the fastest stored velocity in that node, rounded up to 0.1), so a
viewer can grow the node's bounding sphere by `vmax·|Δt|` and not cull points that moved out of it.
An optional top-level `note` (free text) carries caveats such as "preview, partial sky".

**Viewer rule (§5):** the shader draws `inst + (v − sunVelocity)·Δt·1.022712` (pc, Δt in Myr), in
float32 relative to the node centre, so motion is always shown relative to the Sun (the Solar
System sits at the origin). Motion is linear: it ignores the Galaxy's gravity, which bends real
paths; Bailer-Jones 2015 (A&A 575, A35) shows linear motion gives inaccurate, biased encounter
parameters for many stars, so the viewer limits Δt to ±1 Myr and says so.

### Layer note: `star-clusters`

Built by `scripts/build_clusters.py` (raw table) + `build_tiles.py --kind-model star`: every Hunt & Reffert
2023/24 and Baumgardt cluster (7,181). Its `mag` and `color` are **rendering proxies**, not measurements:
M = 4.83 − 2.5 log10(mass/M☉) (member count if no mass), colour a BP−RP-like value from log age. The
`id` is the Hunt & Reffert ID (100000 + row for Baumgardt-only globulars). The viewer opens the
`clusters.json` card of a picked point (nearest entry within 0.05 pc); the full catalogue with facts would
be 2.3 MB, so far unnamed moving groups exist only in this layer.

## 4. Small catalogues (`data/tiles/catalogs/*.json`, committed when < 2 MB)

Named objects for labels and instant search: `named-stars.json`, `local-group.json`,
`local-volume.json`, `messier-ngc.json` (as far as available). Each entry:

```json
{"name": "Sirius", "alt": ["alf CMa", "HIP 32349", "Gaia DR3 2947050466531873024"],
 "kind": "star", "ra": 101.287, "dec": -16.716, "dist_pc": 2.64, "mag": -1.46,
 "xyz": [-1.769, -1.913, -0.408], "ref": "SIMBAD / IAU WGSN"}
```

`spacecraft.json` (`scripts/build_spacecraft.py`, JPL Horizons) has the same entry shape plus
`provenance` (request URL, fetch time, Horizons source, any clipped span) and a `track`, read by
`web/src/solar/spacecraft.ts` and interpolated (cubic Hermite) at the simulation time:

```json
{"name": "Voyager 1", "kind": "spacecraft", "docs": "voyager-1", "xyz": [...], "dist_pc": 0.000835,
 "track": {"t0_jd_tdb": 2451544.5, "step_days": 30, "n": 488,
           "xyz_pc": [x0, y0, z0, x1, ...], "vel_pc_per_day": [vx0, vy0, vz0, ...]}}
```

`xyz`/`dist_pc` are the position at build time; the track is heliocentric, contract frame (§1).

ICRS → Galactic rotation (astropy 7, derived by transforming the ICRS unit vectors; `xyz_gal = M @ xyz_icrs`):

```
M = [[-0.05487565771259165, -0.8734370519556157 , -0.48383507361671546],
     [ 0.49410943719272676, -0.4448297212232951 ,  0.7469821839866675 ],
     [-0.8676661375596576 , -0.19807633727300059,  0.4559838136873016 ]]
```

### 4b. `galaxy-shapes.json` (`scripts/build_galaxy_shapes.py`)

Shapes, not positions, for the galaxies of `local-volume`, `local-group` and `messier-ngc`, merged
by shared name/alias. The viewer looks a shape up by any of `keys` (same `catalogKey`
normalisation as the catalogues) and uses the position and distance of the catalogue entry it
labels. Top level: `version`, `generated_utc`, `conventions`, `sources` (citation per source key),
`provenance` (path of `provenance/galaxy-shapes.json`: services, priorities, counts), `galaxies[]`:

| field | meaning |
|---|---|
| `name`, `keys`, `ra`, `dec`, `pgc` | primary name, every alias, ICRS position, PGC number (if found) |
| `major_arcmin`, `minor_arcmin`, `axes_src`, `axes_def` | apparent diameters; `axes_def` = `D25`, `a26 (Holmberg)` or `2 r_h` |
| `pa_deg`, `pa_src` | major-axis position angle, N through E, J2000, 0–180 |
| `incl_deg`, `incl_src` | disk inclination (0 = face-on), disks only |
| `morph`, `t`, `morph_src` | type string and de Vaucouleurs T |
| `shape` | `disk` or `spheroid` (E, dE, dSph, dS0) |
| `mag`, `mag_band`, `mag_src` | magnitude of the first merged entry that has one |
| `kind`, `docs`, `facts`, `facts_ref` | content contract §3: `facts.major_kpc`/`minor_kpc` (at the primary entry's distance), `inclination_deg`, `position_angle_deg`, `type`, each cited in `facts_ref` |
| `flags` | what is missing or inconsistent |

Source priority, per field: HyperLEDA (live) > OpenNGC > HyperLEDA 2003 (VizieR VII/237, PA
precessed from B1950) > UNGC > McConnachie 2012; inclination HyperLEDA > UNGC > derived from b/a
with q0 = 0.2.

### 4c. Volume layer: `data/tiles/dust/` (`scripts/build_dust.py`)

A layer with `"type": "dust"` in `layers.json` (`path` = this directory). Same frame and unit as
§1. `meta.json` and `PROVENANCE.json` are committed; the textures are rebuilt (35.1 MB).

| file | layout |
|---|---|
| `meta.json` | `fine`/`aux`: `file`, `dims` [nx, ny, nz], `voxelPc`, `origin` (min corner, pc), `format`, `bytes`; `mean`/`std`: log10 code range `lo`, `hi`; `sunAv.max`; `dataRadiusPc`; `rgbExtinctionRatio`; `percentiles`; `landmarks` (validation clouds: name, (l, b), literature distance, map xyz); `citation`, `doi`, `license` |
| `mean_u8.bin` | 418 × 418 × 134 uint8, 6 pc voxels, origin (−1254, −1254, −402): posterior mean A_V per kpc, code 0 = below 10^lo (decoded `c · 10^lo`), 1–255 = 10^(lo + (c−1)/254 (hi−lo)) |
| `aux_rgba8.bin` | 209 × 209 × 67 RGBA8, 12 pc voxels, same origin: R = mean (same code), G = posterior std (its own code), B·256 + A = A_V from the Sun to the voxel centre as uint16 of `sunAv.max` |

Voxel (i, j, k) is the average over origin + [i, i+1) × voxel (x fastest, then y, then z); its value
sits at the cell centre, so a GPU linear sampler at normalised coordinate (x − origin) / (dims × voxel)
reads it exactly (`web/src/dust/grid.ts`, unit-tested). Outside r = 1248 pc the field is 0 (no data).

### 4c. Solar System extra layers (`layers.json` types `small-bodies` and `satellites`)

Not octree tiles: the positions depend on the simulation time, so the files hold orbits.

`data/tiles/small-bodies/` (`scripts/build_small_bodies.py`, from MPCORB.DAT + AllCometEls.txt):

| file | content |
|---|---|
| `<class>.bin` (`neo`, `main`, `trojan`, `centaur`, `tno`, `comet`) | N × 7 float32, interleaved: q (AU), e, i, Ω, ω (rad, J2000 ecliptic), tp (days, perihelion time − `ref_epoch_jd_tt`), H; then N × uint8 flags (low nibble sub-class, high nibble MPC U: 10 = E, 11 = D/F, 15 = blank). Sorted by H, brightest first |
| `desig/<class>-<k>.txt` | one designation per line (MPC packed form; comets: full name), records k·65536 … k·65536 + 65535 |
| `names.json` | search/label entries: name, number, class, record index, the same 7 elements, own epoch offset, U, arc |
| `meta.json` | reference epoch, classes with counts/bytes/sub-class counts, sources and file times |
| `MPCORB_HEADER.txt` | the MPCORB header, verbatim (its terms require it next to the data) |

Elements are converted to the most common MPC epoch (K2669 = JD 2461200.5 TT for the file of
2026-11-13) by two-body propagation in float64; the viewer then solves Kepler's equation for the
time bar's date (`web/src/solar/kepler.ts`, GPU twin in `orbitpoints.ts`) and rotates J2000
ecliptic → ICRS (ε = 84381.448″) → Galactic.

`data/tiles/satellites/` (`scripts/build_satellites.py`): `gp.json` = `{fields, rows, group}` with
the CelesTrak OMM keys SGP4 needs (group 0 stations, 1 Starlink, 2 other active), `jwst.json` = a
geocentric Horizons track in the spacecraft-track shape (contract frame, pc and pc/day, daily),
`meta.json` = snapshot time, counts, element-epoch range, sources.

## 5. Renderer rules (web/)

- Node world position = `center` (float64 in JS) minus camera position (float64), uploaded as a
  float32 uniform per node every frame (relative-to-eye); points stay float32 relative to node centre.
- Logarithmic depth buffer; camera near/far adapt to the distance from the camera to the nearest
  visible node, so 1 pc and 1 Gpc views both work.
- Screen-space LOD: a node is requested when its projected size exceeds a threshold; global point
  budget (default 4 M) with a priority queue by projected size.
