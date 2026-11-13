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

## 4. Small catalogues (`data/tiles/catalogs/*.json`, committed when < 2 MB)

Named objects for labels and instant search: `named-stars.json`, `local-group.json`,
`local-volume.json`, `messier-ngc.json` (as far as available). Each entry:

```json
{"name": "Sirius", "alt": ["alf CMa", "HIP 32349", "Gaia DR3 2947050466531873024"],
 "kind": "star", "ra": 101.287, "dec": -16.716, "dist_pc": 2.64, "mag": -1.46,
 "xyz": [-1.769, -1.913, -0.408], "ref": "SIMBAD / IAU WGSN"}
```

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

## 5. Renderer rules (web/)

- Node world position = `center` (float64 in JS) minus camera position (float64), uploaded as a
  float32 uniform per node every frame (relative-to-eye); points stay float32 relative to node centre.
- Logarithmic depth buffer; camera near/far adapt to the distance from the camera to the nearest
  visible node, so 1 pc and 1 Gpc views both work.
- Screen-space LOD: a node is requested when its projected size exceeds a threshold; global point
  budget (default 4 M) with a priority queue by projected size.
