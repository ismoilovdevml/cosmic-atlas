# Lessons from skymap

Source studied: https://github.com/rulkens/skymap (MIT, "Copyright (c) 2026 Alexander Rulkens"),
shallow clone of commit `73876bd4686803c5456f15a76e0be3066f656b53` (2026-11-12), read on
2026-11-13. I read the code statically and did not install or run it. Every reference below is
`path:line` inside that commit. `docs/prior-work.md` already covers skymap at a high level, so this
file only covers *how* it works and what we take from it.

**One correction to prior-work.md.** skymap is no longer limited to "a few million points, chunking
on the roadmap". **Stars are already chunked**: SKOI/SKOC is a nested-chunk octree streamed into a
GPU pool (`docs/DATA.md:29,43,187`; `docs/RENDERER.md:43-46`). The README's "spatial chunking"
roadmap line (`README.md:155`) refers to galaxies, which are still whole-file tiers. Also, the Gaia
licence is **CC BY-NC 3.0 IGO**, not CC BY-SA. I re-checked https://www.cosmos.esa.int/web/gaia-users/license
on 2026-11-13; it says: "Gaia data are distributed under the CC BY-NC 3.0 IGO license."

---

## 1. How skymap solves each hard problem

### 1.1 Precision across 10^7–10^26 m

- **One frame, one unit.** Everything is ICRS-equatorial Cartesian in **Mpc** (`docs/science.md:13`;
  `src/data/scaleUnits.ts:27-53`). Ours is Galactic and in pc.
- **f64 on the CPU, f32 only at upload, composed before narrowing.** Each object's MVP is built in f64
  (wgpu-matrix `mat4d`) relative to a render origin, and is narrowed once
  (`docs/adrs/0010-continuous-floating-origin-for-free-zoom.md:56-74`;
  `src/utils/math/narrowMat4.ts`). Inversions that need precision run before the narrow
  (`rebaseViewProj.ts`, ADR 0010:66-68).
- **The render origin is fixed at the Sun** (`src/data/renderOrigin.ts:27`). A moving origin is
  listed as known debt (ADR 0010:119-125).
- **Bodies use per-body metre slabs.** `bodyRelativePose.ts` is "the ONE seam" that converts the Mpc
  camera into a body's metre frame (`docs/RENDERER.md:36`).
- **Star octree on the GPU: an integer camera cell plus an f32 fraction.** The camera is passed as
  `camCell: vec3<i32>` and `camFrac: vec3<f32>`. The node-minus-camera vector is
  `vec3<f32>(cell - camCell) - camFrac`, an exact integer subtraction followed by one small f32 term,
  so there is no catastrophic cancellation (`src/services/gpu/shaders/octree/cutIo.wesl:54-63,117-124`).
  The CPU twin does the same in f64 (`src/utils/octree/octreeNodeOriginRelCamMpc.ts:15-35`).
- **Galaxies do not get that treatment.** The vertex stage computes `p.position - u.camPosWorld`
  from two absolute f32 Mpc values (`src/services/gpu/shaders/galaxyCatalog/points/vertexBody.wesl:60`).
  At 3 Gpc the f32 spacing is about 2.4e-4 Mpc (about 240 pc). That is harmless for dots and
  marginal for disks.
- **Overlay clip-w band.** For captions anchored in eye-relative Mpc, `w` fell to about 1e-21, below
  the rasterizer's floor. The fix scales clip space by `1/slab.near` (`docs/RENDERER.md:78`).

### 1.2 Depth

- **A painter chain of "slabs", each with its own depth clear** (`src/services/engine/frame/slabs.ts`).
  NEAR0 (Sun, Earth, planets) is **reversed-Z depth32float**. COSMO (galaxies, filaments) is
  **standard-Z depth24plus** with fixed near/far = 0.01 / 50,000 Mpc
  (`slabs.ts:99-102,115-116`; `pickProgram.ts:80-81`). Body slabs `BODY[k]` get per-frame near/far
  from the body's view-axis extent (`slabs.ts:150-195`). One constant table drives every pipeline's
  `depthCompare` and clear value, so "a half-reversed state is impossible" (`slabs.ts:89-98`).
- **Additive point content is depthless.** Overlays judge occlusion from the composite's alpha, not
  from depth, because depth does not survive across chain rows (`docs/RENDERER.md:40`).
- **Reversed-Z gotcha.** Full-screen ray reconstruction must use the homogeneous far-point form.
  `(invMvp*clip).xyz/w` divides by `w → 0` at z = 0, the far plane (`docs/RENDERER.md:74`).

### 1.3 Point-sprite rendering, brightness and tone mapping

- **Photometric core shared by every star stage** (`src/services/gpu/shaders/lib/starPhotometry.wesl`):
  - Pogson flux anchored at 10 pc (`D_REF_MPC = 1e-5`, `:100`), with an inverse-square floor at
    0.1 pc (`:107`).
  - Light is deposited **per unit solid angle**, not per device pixel. Radii are converted to a
    reference of `REF_PX_PER_RAD = 935.3` (1080 px at 60° fov) before computing the peak
    (`:130-139`), so 270p and 1080p, a dome face or an XR eye all read equally bright. A 270p canvas
    used to read 3.6× brighter (`:126-127`).
  - The peak is `EXPOSURE·brightness·flux / (K_GAUSS·r²)`, where `K_GAUSS = 0.7268` is the disc
    integral of a **rim-zeroed Gaussian** `(exp(-4r²) − e⁻⁴)/(1 − e⁻⁴)` (`:61-91,166-168`). The
    integrated light is exact and the sprite has no hard edge.
  - The glow radius has a ceiling at 384 px, and the peak is computed from the **pre-ceiling** radius,
    so a very near star freezes its surface brightness instead of blowing out (`:45-59`).
- **Hue-preserving knee** `K·(1 − e^(−I/K))`, K = 8. It compresses the scalar *before* the tint
  multiply, so bright stars whiten by accumulation, not by per-channel clipping. It is linear below
  K, so LOD swaps stay invisible (`src/services/gpu/shaders/lib/starKnee.wesl:11-50`).
- **Display exposure ramp versus camera distance.** Anchors are 6× at 1 pc, 23× at 3 kpc and 28× at
  10 kpc, interpolated log-log, because a monitor cannot dark-adapt
  (`src/layers/starCatalog/photometry/utils/starExposureRamp.ts:20-40`, anchors in
  `.../data/starExposureRamp.ts`).
- **Galaxies:** magnitude and diameter are baked into a surface-brightness amplitude
  (`docs/science.md:60`).
- **HDR pipeline:** one `rgba16float` HDR target, then a selectable tone curve (Linear, Reinhard,
  Asinh, Gamma 2.0, ACES), a 5-level bloom pyramid, and extended-range output when the display
  supports it (`docs/science.md:52-56`; `src/services/gpu/device.ts:126-135`).
- **Far stars:** aggregate glows draw at quarter resolution (`STAR_AGGREGATE_DIVISOR = 4`, 1/16 of
  the fragments) and are capped at the refine footprint. This took the phone pose from about 20 ms
  to about 6 ms (`docs/RENDERER.md:45`; `starAggregatesTarget.ts:13`).

### 1.4 Star colour

- **Points:** BP−RP is mapped through five hand-picked spectral anchors (O/B, A/F, G, K, M), with
  linear mixes at BP−RP = −0.3/0.3/0.85/1.25/2.2 (`src/utils/color/starTintFromBpRp.ts:57-71`).
- **Resolved spheres:** a blackbody-locus polynomial in temperature (`temperatureToLinearRgb.ts`,
  `docs/science.md:70`).
- **No dereddening.** Colour comes from raw `bp_rp`. The absolute magnitude is
  `G − 5 log10 d + 5` with no A_G (`tools/stars/buildStars.ts:169-172`).

### 1.5 Galaxy LOD: dot → disk → thumbnail → hi-res

- **One ladder file** (`src/layers/galaxyCatalog/lod/data/galaxyLodBands.ts:20-53`):
  - below 4 px: point only;
  - 8→14 px: crossfade to a procedural disk, oriented by axis ratio and position angle (a hash
    fallback, flagged per row);
  - 24→40 px: crossfade to a real thumbnail;
  - 120→160 px: crossfade to a hi-res texture (famous galaxies only).
- **Crossfades** are smoothsteps whose two sides sum to one (`docs/science.md:63`).
- **Thumbnail atlas:** 2048² made of 128² slots, with LRU eviction (`docs/RENDERER.md:23`).
  - Images come from SDSS DR18 ImgCutout, or from **CDS hips2fits** for DSS, because ESO's DSS
    endpoint blocks CORS (`docs/RENDERER.md:24,55`).
  - The fetch queue is idempotent and keeps both a `bitmapReady` and a `bitmapFailed` set, to stop
    retry storms (`:56`).
  - Hi-res famous textures go in a `texture_2d_array` of 8 layers
    (`docs/adrs/0002-tiered-thumbnail-textures.md`).
- **Scaling cost: the disk planner walks every galaxy row on the CPU.** It is decimated to 1/8 of the
  rows per frame "because walking ~2.5M rows each frame is too slow"
  (`docs/backlog/2026-11-06-indexed-pure-disk-planner.md:7-9`;
  `src/layers/galaxyCatalog/lod/subsystems/diskPlannerWalk.ts:44,54`).

### 1.6 GPU picking

- **Format:** an `r32uint` target holding `(sourceCode << 26) | (localIdx + 1)`. That is 6 bits of
  per-session source code (63 is the sentinel) and 26 bits of index, up to 67 M per source
  (`src/data/selectionEncoding.ts:3-8,14-44`).
- **Only the cursor pixel is rasterised.** Each slab's f64 view-projection is pre-multiplied by a
  crop matrix, then narrowed. Every slab renders into one shared **1×1** colour texture plus a 1×1
  depth texture per format. One texel per slab is read back, and a CPU fold resolves near→far
  occlusion (`src/services/engine/frame/pickProgram.ts:23-46`;
  `src/services/engine/frame/windowedSlabView.ts:8-26`).
- **One pick in flight.** Hover and click requests coalesce, and the readback latency acts as the
  throttle (`src/services/engine/interaction/createPickDriver.ts:1-9,35-76`).
- **Picking rules:**
  - Stars get a minimum pick radius of 3.5 px (`starCullSlack.ts:16`).
  - "The same value gates draw and pick, so a thing faded to 0 cannot be clicked"
    (`docs/adrs/0012-layers-declare-visibility.md`).
  - A star pick names a **pool row**. Selection therefore stores the catalogue ordinal, because the
    slot can be refilled by another chunk (`docs/RENDERER.md:81`).

### 1.7 Data formats and sizes

| Format | Content | Record | Notes |
|---|---|---|---|
| SKMP v10 | galaxies | 64 B/row, row-major: u64 objID, xyz f32 Mpc, 5 mags, b/a, PA, diameter, class/flag bytes, angular weight u8, spec-z, log M★ (`src/layers/galaxyCatalog/records/data/galaxyCatalogFormat.ts:17-20,38-107`) | One file per (source, tier). Tiers are about 300k / 600k / 2.5M galaxies (`docs/DATA.md:67`). |
| SKOI / SKOC v1 | stars (octree index + chunks) | 10-byte framing + JSON header + 24 B node rows (morton u32, level u8, childMask u8, firstRecord, ownCount, blobCount, chunkRef) + **columnar** records aligned to 8 (`src/data/octree/octreeFormat.ts:3-51`) | Star record = **8 B**: `u16x3` offset as a fraction of the owning node's box, plus absMag u8 and colour u8 dequantised as `q0 + raw·q1` (`src/data/octree/starOctreeFamily.ts:13-34`). **No source_id.** |
| SKST v1 | legacy star tiers | 6 B records | Kept as an A/B fallback. |
| CCAT / SCFD / FILA / SATG / SHEL / STRM | structures / f16 volumes / filament strips / satellites / Local Bubble mesh / streams | `docs/DATA.md:25-35` | Each has magic + version, and a version bump makes old files fail loudly (`docs/DATA.md:23`). |

- **Star bake numbers (2026-10-11):**
  - Index: 145 rows, 9,067 records, 80 KB.
  - 993 chunks, nested two deep. Chunk bounds are 32,768 records / 2,048 rows.
  - The build needs 16 GB of heap, peaked at 10.85 GB RSS and took 111 s (`docs/DATA.md:187`).
- **Grid:** 10 bits per axis, from the population bounding box. The leaf cell is about 23 pc (`tools/stars/buildStars.ts:81,85,367-380`).
- **Stratification:** a star lives at level `L(M) = round(log2(refUnit·10^((mLim−M)/5)·thr/cellEdge))`,
  with mLim = 10, so bright stars sit high in the tree (`tools/octree/levelForMagnitude.ts:5-16`;
  `buildStars.ts:88-92`).

### 1.8 Chunk streaming and the GPU cut

- **The cut runs on the GPU** (`src/services/gpu/shaders/octree/cut.wesl:1-60`) in one flat pass
  over all pool rows.
  - Refine proxy: `edge²/dist²` (`:103-108`).
  - A row draws its own records when its parent refines, and draws a **flux "blob"** for its whole
    subtree when it does not refine itself. "own + blob is its subtree's whole flux, so the cut
    conserves light level by level" (`:7-13`).
  - **Budget as a threshold:** the cost of each candidate goes into a 1024-bin log-proxy histogram
    (64 bins per octave). `pickThreshold` walks down from the top until the instance budget is
    spent, and `emit` refines only the bins above that (`:23-27,110-113`). Output goes to
    `drawIndirect`.
  - **Fades:** two linear channels per row (own and blob), so a split cross-dissolves while
    conserving flux (`:29-33`).
  - **Folded subtrees:** a sparse subtree of at most `CUT_FOLD_RECORDS` records draws as points with
    no blob (`:16-21`).
- **Chunk planner (CPU)** (`src/utils/octree/planOctreeChunks.ts:1-11`):
  - It walks resident chunks with the same frustum and proxy tests.
  - Priority is the chunk's best root proxy. The best `limit` chunks are kept, resident or not, and a
    child always ranks below its parent (`docs/RENDERER.md:46`).
- **Pool and concurrency:**
  - Fixed slots per tier: 64 / 128 / 256 (`src/layers/starCatalog/sources/gaia-stars.ts:31-35`).
  - 4 concurrent fetches (`src/data/octree/octreeChunkConcurrency.ts:2`).
- **Cadence:** re-cut every other frame while moving; plan every 4 frames (`docs/RENDERER.md:44`).
- **Residency ordering:** a chunk's rows land before its roots' resident bits are set, and eviction
  clears the bits first, deepest chunk first (`docs/RENDERER.md:43,79-80`).
- **Content addressing:** chunk names carry their own hash, `level-morton.hash.bin`
  (`octreeFormat.ts:53-58`). The index is written last, so an interrupted bake still points at the
  old chunks (`docs/DATA.md:187`).

### 1.9 Search index

- **Cmd+K palette, ranked over in-memory lists** on every keystroke
  (`src/utils/palette/rankPaletteMatches.ts:26-122`). The lists are famous objects, places, exhibits,
  tours, layer rows, about 48k PGC aliases (`data/pgc_aliases.json`, 1.76 MB) and about 370
  structures.
- **Scoring:** exact match beats prefix, prefix beats substring, and there is a spaceless variant
  (`ngc4565`) (`scoreAliasMatch.ts:35-57`). Alias and structure lists are capped at 50 for the DOM
  (`rankPaletteMatches.ts:17-21`).
- **Gaps:** no inverted index, no coordinate parsing, no catalogue-ID lookup for survey stars or
  galaxies, and no remote resolver.

### 1.10 Deep links

- Hash keys: `#focus=`, `#pose=` (exact camera at an exact instant), `#t=`, `#tour=`, `#exhibit=`,
  `#clip=` (`README.md:33-37`; `src/services/url/*`).
- **Survey stars encode as `star-<record index>`**, "whose bin index is the only identity it has"
  (`src/layers/starCatalog/selection/utils/encodeStarFocusId.ts:1-19`). These links break whenever
  the octree is re-baked.

### 1.11 Tours

- **A tour is plain serializable data:** `{id, label, beats[]}`. Each beat has an `enterClip`
  (camera choreography), a `caption {title, lines}` and a `dwellClip`. Focus targets are **durable
  refs resolved at playback**, so tours survive catalogue rebuilds. A scene snapshot is restored on
  exit (`src/@types/animation/tour/Tour.d.ts:1-35`; `src/data/animation/tours/grandTour.ts:33-90`).
- Tours are registered in `src/compositions/appTours.ts:14-18`.
- `npm run record-tour` renders tours to 4K video offline (`README.md:148`).

### 1.12 Milky Way model

- **The model:** a Gaussian-mixture fit to the Freudenreich 1998 COBE/DIRBE NIR emissivity model.
  The warp is not modelled (`docs/science.md:46`).
- **Rendering:** each component is an instanced Gaussian ellipsoid, and each fragment integrates its
  Gaussian along the view ray **in closed form**:
  `A·sqrt(π/2a)·exp(−½(c−b²/a))·erfc(b/√(2a))`
  (`src/services/gpu/shaders/lib/gaussianIntegral.wesl:1-90`;
  `src/services/gpu/shaders/milkyWay/field/fieldSplat/fragment.wesl:27-40`).
  - It uses its own erfc polynomial, with exponents folded together to avoid inf·0 (`:40-50`).
  - Emission is additive at reduced resolution; dust is a separate multiplicative transmittance pass
    (`docs/science.md:74-75`).
- **Handoff:** the Gaia field hands off to the model at 8–25 kpc of camera distance (`gaia-stars.ts:7-9`).

### 1.13 Labels

- **Text:** MSDF glyphs from a multi-font atlas array, including curved text (`docs/science.md:104`).
- **Declutter:** one director per slab merges every producer's labels. It sorts them by
  `declutterPriority` and greedily accepts a label when its **padded measured text rect** (8 px pad)
  hits no accepted rect. Appear and disappear use a 300 ms smoothstep
  (`src/services/engine/subsystems/label2DDirector.ts:184-250`;
  `src/data/labels/cosmoLabelDirectorConfig.ts:15-20`).

### 1.14 Performance budgets

- **Hard-coded budgets:**
  - The star draw budget is **1.5 M instances on every tier**; only the chunk pool varies
    (`gaia-stars.ts:31-35`).
  - Refine threshold 0.16 (`src/layers/starCatalog/state/starCatalogs/initialState.ts:11`).
  - DPR capped at 2 (`src/services/gpu/device.ts:213-231`).
  - Render on demand: the loop sleeps when nothing moves (`docs/RENDERER.md:32`).
- **Measured:**
  - The `large` galaxy tier costs 21.8 ms per frame against 7.8 ms for `medium`. "Blows the 60fps
    budget on its own" (`docs/backlog/2026-07-21-perf-harness-findings.md:9-21`).
  - Frames in flight are not capped: they queued about 7 deep, with 69 ms of input latency
    (`docs/backlog/2026-11-11-frames-in-flight-cap.md:1-12`).
- **Tooling:**
  - Per-pass `timestamp-query` timings (`device.ts:85-91`).
  - A GPU-memory ledger that wraps `createBuffer`/`createTexture` (`docs/RENDERER.md:39`).
  - A headless `npm run perf` harness.

---

## 2. WebGPU landmines they documented, and their fixes

| # | Landmine | Their fix | Ref |
|---|---|---|---|
| 1 | `queue.writeBuffer` is ordered against `submit`, not against draws recorded between writes, so N draws read the last write | Bake per-instance data into vertex/storage buffers; per-object uniform buffers; residency writes only in fetch callbacks, never mid-encode | `docs/RENDERER.md:53-54,79`; `docs/backlog/2026-07-29-star-renderer-uniform-buffer-race.md` |
| 2 | WebKit (iOS) rejects WGSL that Chrome/Tint accepts (e.g. `texture_1d` sampling). One invalid pipeline silently drops the **whole frame**, with no error | Store 1D LUTs as N×1 `texture_2d`; route every module through a dev compile logger that prints `getCompilationInfo()` with the linked WGSL | `docs/RENDERER.md:58`; `src/services/gpu/shaderCompileLogger.ts` |
| 3 | Implicit-derivative `textureSample` breaks uniformity rules and reads garbage across atlas seams | `textureSampleLevel` for atlases | `docs/RENDERER.md:61` |
| 4 | `textureSample` is illegal in the vertex stage; filtering encoded bytes blends codes; Brave/Safari/Firefox perturb canvas `getImageData` | `textureLoad` + `unfilterable-float`; `copyExternalImageToTexture`, never a CPU readback | `docs/RENDERER.md:62` |
| 5 | Adreno (Android Chrome) misreads a storage-buffer struct passed **by value** into a helper (valid WGSL, wrong on device) | Pass fields as scalars | `docs/RENDERER.md:65` |
| 6 | Reversed-Z: `(invMvp*clip)/w` degenerates at the far plane | Homogeneous far-point ray form | `docs/RENDERER.md:74` |
| 7 | f32 cancellation, magnified by narrow lenses (`b²−c` ray–sphere, `acos` near ±1) | Closest-approach discriminant, `atan2`, rebase in f64 on the CPU first | `docs/RENDERER.md:75`; `.claude/skills/wesl-shaders/SKILL.md:77-93` |
| 8 | Denormal flush: squaring about 1e-19 Mpc goes to 0, then `inverseSqrt(0)` = NaN | Rescale to body radii; keep value² ≥ 1e-37 | `SKILL.md:71` |
| 9 | `layout: 'auto'` bind groups are not interchangeable between pipelines (the pick reads back zeros) | Explicit pipeline layouts, or build against the consumer's `getBindGroupLayout` | `SKILL.md:73` |
| 10 | Pick passes inherit stale bind groups left in the encoder | Every pick draw binds its own complete `@group(0)` | `docs/RENDERER.md:77` |
| 11 | Clip `w` outside the rasterizer's interpolation band (SwiftShader about 1e-12…1e11) | Per-frame clip scale `1/near` | `docs/RENDERER.md:78` |
| 12 | Cubemap capture faces flip winding | Swap cull mode per view | `docs/RENDERER.md:50` |
| 13 | Duplicate `@builtin(position)` fails only at `createShaderModule` | Compile logger | `SKILL.md:65-67` |
| 14 | `0*NaN = NaN` ruins bisect-by-multiply | Replace with a literal | `SKILL.md:70` |
| 15 | `requestDevice` throws on an unknown feature or a limit above the adapter's maximum | Drop-and-clamp against `adapter.features`/`limits` | `src/services/gpu/device.ts:81-108` |
| 16 | A hard-coded swap format is wrong on some platforms | `getPreferredCanvasFormat()`, and switch to `rgba16float` only when HDR is enabled | `device.ts:117-124` |
| 17 | **No sRGB encode on a `bgra8unorm` swap chain**: every look was tuned on linear values written straight to the display | Open, `needs-design` (an app-wide re-tune) | `docs/backlog/2026-11-06-swap-chain-no-srgb-encode.md:1-20` |
| 18 | Uncapped frames in flight (about 7 deep, 69 ms latency) | Open: an `onSubmittedWorkDone` fence, at most 1–2 in flight | `docs/backlog/2026-11-11-frames-in-flight-cap.md` |
| 19 | A slot pool that evicts its own working set every frame | `allocate()` returns `null` = skip, never retry | `docs/RENDERER.md:72` |
| 20 | A chunk slot reused before its bits are cleared: one frame refines over stale rows | Rows first, bits last; on evict, clear bits first, deepest first | `docs/RENDERER.md:80` |

---

## 3. Adopt (ranked)

These are ideas to re-implement in our `three/webgpu` + TSL stack. If we port any snippet verbatim
(the WGSL erfc or `starPhotometry` constants, for example), we must keep skymap's MIT notice
("Copyright (c) 2026 Alexander Rulkens" plus the permission text) in that file.

I checked three 0.186.1 in `web/node_modules/three` for the features named below. Each one exists:
`reversedDepthBuffer` in `Renderer.js:62,97`, `BufferGeometry.setIndirect` in `BufferGeometry.js:253`
(the backend calls `drawIndexedIndirect`), indirect compute dispatch in `WebGPUBackend.js:1884-1925`,
`PerspectiveCamera.setViewOffset`, `readRenderTargetPixelsAsync`, and
`RedIntegerFormat`/`UnsignedIntType`. **None of them has been tried in our app yet.**

1. **Flux "blob" aggregates for subtrees we do not draw.**
   - *Problem:* our additive LOD drops the integrated light of everything below the budget, so a
     distant disc looks too faint and grainy.
   - *Change:* each node's meta gets one aggregate record for its whole subtree (flux-weighted
     centroid, summed flux, flux-weighted colour). Draw it while the node's children are not drawn,
     and crossfade it out linearly as children appear (skymap `cut.wesl:7-13,29-33`).
   - *Lands in:* `pipeline/build_tiles.py` (compute per node), contract §3 (a `blob` field per node
     in `meta.json`), `web/src/tiles/streamer.ts` (draw rule) and `web/src/render/pointMaterial.ts`
     (blob size = node footprint).
2. **Bundle subtrees into chunk objects, with nested chunk refs, content-hashed names, and the index
   written last.**
   - *Problem:* this answers prior-work's "hundreds of thousands of files" problem without needing
     range requests: at 1.47 B stars and 20k per node, one file per node means at least 73k nodes ×
     2 files.
   - *Change:* use skymap's measured bounds as the starting point (32,768 records / 2,048 rows per
     chunk) and move from `n/<node>.bin` to `c/<level>-<id>.<hash>.bin`.
   - *Lands in:* contract §3, `pipeline/build_tiles.py`, `web/src/tiles/format.ts` and
     `web/src/data/manifest.ts`.
3. **Quantised, columnar render records.**
   - *Change:* store positions as `u16x3` fractions of the node box. That is 6 B instead of 12, with
     a resolution of box/65,536 (about 0.03 pc for a 2 kpc root). Lay the columns out SoA, aligned
     to 8 (skymap `octreeFormat.ts:22-42`; `decodeOctreeBody.ts:26-50`). The render record shrinks
     from 16 B to 10 B (6 + rgb + lum), or 8 B with a colour-index LUT.
   - *Gain:* at 1.47 B stars, render data drops from about 23.5 GB to about 14.7 GB.
   - *GPU side:* decode in TSL as `nodeOrigin + attr/65536·edge`.
   - *Lands in:* contract §3 (a v2 record), `pipeline/build_tiles.py`, `web/src/tiles/format.ts` and
     `web/src/render/pointMaterial.ts`.
4. **GPU picking through a 1×1 cropped projection.**
   - *Problem:* our CPU picker walks the points of every drawn node near the ray
     (`web/src/main.ts:452-503`), and it slows down as the budget grows.
   - *Change:* use `camera.setViewOffset(W, H, x, y, 1, 1)`, which is exactly skymap's crop
     (`windowedSlabView.ts:13-26`). Render a pick material into a 1×1
     `RenderTarget({type: UnsignedIntType, format: RedIntegerFormat})` and read it with
     `readRenderTargetPixelsAsync`, keeping one pick in flight.
   - *Encoding:* `(layer<<28)|(nodeSlot<<16)|pointIdx`. `nodeCapacity` 20,000 fits in 16 bits.
   - *Rules:* keep a minimum pick footprint of about 3.5 px, and do not let anything faded to zero
     take a click.
   - *Lands in:* `web/src/render/pick.ts` (new) and `web/src/main.ts`.
5. **Photometry per solid angle.**
   - *Problem:* our `brightness.ts`/`pointMaterial.ts` normalise per device pixel (`BASE_PX·dpr`), so
     brightness changes with canvas height and fov.
   - *Change:*
     - Convert radii to reference px/rad before the peak (`starPhotometry.wesl:122-139`).
     - Use a rim-zeroed Gaussian with its exact integral (`:61-91`).
     - Compute the peak from the pre-ceiling radius (`:45-59`).
     - Keep the CPU twin in `brightness.ts`.
6. **Hue-preserving knee before tint**, `K(1−e^(−I/K))` (`starKnee.wesl:46-50`). Apply it per glow in
   `pointMaterial.ts` as well as in our global asinh in `web/src/render/post.ts`, so LOD swaps stay
   linear below the knee.
7. **Linear opacity fades on refine/merge.** Give each node an opacity that walks toward 1 or 0, so a
   split cross-dissolves instead of popping. *Lands in:* `streamer.ts` (per-node uniform or per-mesh
   `opacity`) and `pointMaterial.ts`.
8. **Stable-ID deep links** (`#focus=gaia-dr3:<source_id>`, `#focus=desi-dr1:<targetid>`). This is
   better than skymap's record index. Store the id plus position in the hash, fly to the position,
   then confirm the id from that node's `.ext.bin`. Also add `#pose=` with a time component.
   *Lands in:* `web/src/main.ts` (`writeHash`/`readHash`, lines 864-885) and
   `web/src/data/resolve.ts`.
9. **Tours as data.** Use beats `{focusRef, enterPath, caption, dwell}` resolved at playback, restore
   the scene state on exit, and keep a dev flag for harness tours. Move the inline tour out of
   `main.ts` (around lines 808-860) into `web/src/tour/*.ts`. Our van Wijk–Nuij path
   (`web/src/math/flyto.ts`) is the enter clip.
10. **Labels: padded measured-rect declutter plus a 300 ms smoothstep envelope**, ranked by priority.
    *Lands in:* `web/src/render/labels.ts`, which today declutters on a screen grid with no fade.
11. **Galaxy LOD ladder** (dot → procedural ellipse → thumbnail) with crossfades that sum to one.
    - Fetch thumbnails through hips2fits, which is CORS-safe for DSS.
    - Use an atlas of 128² slots with LRU and idempotent ready/failed sets.
    - For DESI, Legacy Surveys cutouts are the natural source (CORS *not verified*).
    - Use real b/a and PA where present, and flag fallbacks per row. Our current orientation is a
      position hash (`pointMaterial.ts:84-89`).
    - *Lands in:* `web/src/render/galaxyThumbs.ts` (new).
12. **Analytic Gaussian-splat Milky Way.** Build arms and disc as anisotropic Gaussians with the
    closed-form erfc ray integral, and add a separate multiplicative dust pass. Our Reid 2019 arm
    model (`web/src/render/milkyway.ts`) can be expressed as chains of Gaussians.
13. **Content-hashed manifest, versioned format folders, manifest written last**, so a page load
    never pairs files from different builds (`docs/DATA.md:39,55-59`). *Lands in:*
    `pipeline/build_tiles.py` and `web/src/data/manifest.ts`.
14. **Frame hygiene.**
    - Render on demand.
    - Cap frames in flight at 1–2.
    - Cap DPR at 2.
    - Use `trackTimestamp` per-pass timings in a debug overlay.
    - Track GPU memory per owner.
    - Log WGSL compile output in dev.
    - *Lands in:* `web/src/main.ts`.
15. **Later: move the cut to the GPU.**
    - Run a TSL compute cut with a log-proxy histogram threshold and indirect draws.
    - Pass the camera to the GPU as an integer cell plus an f32 fraction.
    - Do this only after items 1–3, and only if the CPU heap in `streamer.ts` becomes the
      bottleneck.

**What we already do as well or better:** f64 relative-to-eye per node (`streamer.ts:262-270`), with
three.js composing `modelViewMatrix` in JS doubles before upload. Planck18 cosmology including
radiation (`web/src/math/cosmology.ts`). A WebGL2 fallback (`main.ts:77`).

---

## 4. Do better: where we can beat skymap

**Catalogue completeness (the main differentiator)**

- **Stars:**
  - skymap keeps only G < 14 (`tools/fetch/fetchGaia.ts:104,125-131`), about 0.93% of DR3, 16.8 M
    stars.
  - It **drops** every star beyond 12 kpc (`tools/stars/buildStars.ts:78`).
  - The Morton grid is fixed at **10 bits per axis** (`src/data/octree/octreeFormat.ts:46`;
    `buildStars.ts:81`), and its cell size comes from the population's bounding box
    (`buildStars.ts:367-380`). Growing the extent therefore coarsens every leaf: about 23 pc today,
    and about 60 pc for a 60 kpc box.
  - Each node holds at most 8,192 own records (`octreeFormat.ts:44`).
  - Our additive octree, with explicit centre/half per node, has none of these ceilings.
- **Galaxies:**
  - skymap has no spatial index. Whole tier files are loaded and the CPU walks every row
    (`docs/backlog/2026-11-06-indexed-pure-disk-planner.md:7-9`).
  - The large tier (about 2.5 M) blows the frame budget at 21.8 ms
    (`docs/backlog/2026-07-21-perf-harness-findings.md:9-21`).
  - DESI is three NGC-only LSS patches: a 2.5° cone (`tools/catalog/desiPatches.ts:63`), a
    dec-band wedge and the Sloan Great Wall, off by default (`data/raw/desi/README.md:1-25`).
  - **Our full DR1 octree (18.7 M) is something they cannot load without re-architecting.**

**Identity, uncertainty and provenance**

- **No IDs.** skymap's star records are 8 B with no source_id (`starOctreeFamily.ts:13-27`), and its
  survey-star deep links are record indices (`encodeStarFocusId.ts:1-19`). Our `.ext.bin` carries
  u64 ids.
- **No uncertainty.** skymap fetches only `r_med_geo`/`r_med_photogeo`, never `r_lo`/`r_hi`
  (`fetchGaia.ts:126-127`; `tools/stars/resolveStarDistancePc.ts:53-58`), so it cannot show distance
  uncertainty.
  - **Gap in our own contract:** §3's ext record (id, mag, color) has no slot for
    `dist_lo_pc`/`dist_hi_pc`, although §2's raw tables have both.
  - *Fix:* extend the ext record (for example 24 B: + lo f32 + hi f32), and add a u8 "fractional
    uncertainty" code to the render record so the GPU can draw a fuzz or line-of-sight error bar.
- **Provenance.** skymap's `ATTRIBUTIONS.md` is excellent, hand-written prose: 3,229 lines with a
  verbatim licence quote and a "Checked" date per source. We can match its rigour and also make it
  machine-readable: carry our `PROVENANCE.json` (query, URL, UTC time, cuts, DOI) into each layer's
  `meta.json`, and show it in the info card.

**Accuracy problems in their maths**

I checked these against astropy 7 in our `.venv` with two throwaway scripts (not committed). Their implementation agrees with
`FlatLambdaCDM(H0=70, Om0=0.315)` to 0.01 Mpc, so the differences below come from model choices, not
from the integrator.

| Issue | skymap ref | Effect, measured |
|---|---|---|
| H0 = 70 mixed with Planck's Ωm = 0.315, no radiation | `src/utils/math/constants.ts:21,27`; `redshiftToDistanceMpc.ts:30` | Comoving distances are **3.35% (z = 0.01) to 3.73% (z = 7) shorter than Planck18**, for example 3274.9 vs 3395.6 Mpc at z = 1 |
| Lookback time uses the coasting approximation `z/(1+z)·t_H` | `src/utils/math/lookbackTimeGyr.ts:9-14,36-40` | −5.6% at z = 0.1, **−12.0% at z = 1** (6.98 vs 7.94 Gyr), −10% at z = 3. The info card's `earthEra` is derived from it (`buildGalaxyInfo.ts:202`) |
| Absolute magnitude from **comoving** distance, although the function's docstring says luminosity distance | `src/utils/math/absoluteMagnitude.ts:35-40`, called with `redshiftToDistanceMpc(z)` at `tools/parsers/glade.ts:385-387`, `tools/catalog/subsampleByAbsMag.ts:82-84`, `src/layers/galaxyCatalog/records/present/buildGalaxyInfo.ts:225` | M is too faint by 5 log10(1+z): **0.21 mag at z = 0.1, 0.57 at z = 0.3, 1.5 at z = 1, 3.0 at z = 3**. This skews the "volume-limited" tier backbone against distant galaxies (`tools/catalog/selectTierRecords.ts`; `buildAllBins.ts:897`), the Tully-relation diameters derived for GLADE, and the M_g shown in info cards. No K-correction either |
| Horizon shell 14.3 Gpc | `src/layers/cosmicHorizon/horizon/data/horizonRadiusGpc.ts:14` | Planck18 particle horizon = 14.17 Gpc (+0.9%). Their own cosmology gives 13.88 Gpc (+3.0%), so the shell and the galaxies disagree |
| No extinction in star M_abs, and no dereddened colour | `buildStars.ts:169-172`; `starTintFromBpRp.ts:57-71` | Disc stars a few kpc out are mis-stratified (too faint) and reddened |
| Frame rotations | `src/data/superGalacticTransform.ts:68-77` | Fine: 0.32″ (Galactic) and 0.27″ (supergalactic) from astropy, at most 0.64 kpc at 500 Mpc |

**Two of these problems are also ours**

- **(a)** Our `pipeline/build_tiles.py:121-133` computes the galaxy `lum` code from the comoving
  `dist_pc`.
  - *For rendering this is correct:* the shader reapplies the same Euclidean distance, so it
    reproduces the observed m from the Sun.
  - *The real problem is the contract:* §3 calls the value "M_abs". Rename it a Euclidean
    pseudo-magnitude, and never show it as M.
  - *For physical M:* compute it with d_L = (1+z)·d_C plus a K-correction, and keep it in the ext
    record.
- **(b)** We also skip extinction (`build_tiles.py:125`). DR3 `ag_gspphot`/`ebpminrp_gspphot`, or the
  Edenhofer map within 1.25 kpc, would let us beat them here.

**Platform**

- **No WebGL fallback.** `main.tsx` shows a static "unsupported" page when `navigator.gpu` is
  missing (`src/unsupportedPage.ts:1-12`). Our three.js WebGL2 backend reaches more users.
- **Colour pipeline.** skymap's swap chain gets linear values with no sRGB encode, and every look was
  tuned that way (`docs/backlog/2026-11-06-swap-chain-no-srgb-encode.md`).
  - *Check ourselves:* `web/src/render/post.ts` sets `outputColorTransform = false`, so we also write
    our own values straight out. Lupton asinh output is display-referred by design, but we must
    document the transfer function and test sRGB tile colours against an encode. **Not tested yet.**

**Search**

- skymap only does linear substring matching over in-memory lists, with no coordinates and no
  survey IDs (`rankPaletteMatches.ts`).
- We already resolve names through CDS Sesame (`web/src/data/resolve.ts`). To go further, add
  RA/Dec/sexagesimal and "Gaia DR3 <id>" / "DESI <targetid>" parsing. A Gaia `source_id >> 35` is
  the HEALPix order-12 pixel, which gives the direction immediately.

**DR4 readiness**

- skymap is wired to `gaiadr3.gaia_source_lite` joined to EDR3 Bailer-Jones distances
  (`fetchGaia.ts:125-131`).
- If our fetch is parameterised by release (table names, distance source, column map), the full
  2,000,033,276-row DR4 `gaia_source` can drop in on 2026-12-02.
- Whether DR4 ships a Bailer-Jones-style distance table at launch is **unknown**. To find out, check
  the DR4 content page on release day.

**Hard-coded budgets**

- One 1.5 M star draw budget for every tier (`gaia-stars.ts:31-35`).
- A fixed COSMO near/far of 0.01–50,000 Mpc (`slabs.ts:115-116`).
- A render origin fixed at the Sun (`renderOrigin.ts:27`).
- 4 fetch connections (`octreeChunkConcurrency.ts:2`).
- No adaptive tier per device: the user picks it (`docs/DATA.md:67`).
- Our improvement: derive the point budget from measured frame time.

**Complexity**

- 4,379 source files, 270 shader files and more than 7,500 tests (`README.md:149`) for one author.
  Most of it serves the solar system, Earth tiles and missions.
- A small, documented tile format plus a reproducible pipeline is easier for others to adopt and
  cite, and that is our edge.

---

## 5. Data sources and licence notes to match or credit

Licence statements below are skymap's own, as recorded in `ATTRIBUTIONS.md` with their "Checked"
dates. I re-verified only the Gaia one (2026-11-13).

| Source | Licence as stated | What to do | Ref |
|---|---|---|---|
| Gaia DR3 (+ EDR3 Bailer-Jones, GCNS) | **CC BY-NC 3.0 IGO**; commercial use needs written ESA authorisation (data.licences@esa.int) | Correct prior-work.md (it says CC BY-SA). Use the verbatim DPAC acknowledgement; cite Prusti 2016 + Vallenari 2023, Brown 2021 (EDR3), Bailer-Jones 2021, Smart 2021. The non-commercial clause applies to our tiles and screenshots | `ATTRIBUTIONS.md:374-457`; ESA page re-checked 2026-11-13 |
| DESI DR1 | CC BY 4.0 + required verbatim acknowledgement + "Indicate if any changes are made" | Copy the acknowledgement text verbatim into our credits; cite DESI Collaboration DR1 paper (AJ 171, 285); state our cuts | `ATTRIBUTIONS.md:309-335` |
| Hipparcos-2 (van Leeuwen 2007) | via CDS | Credit if we add the bright-star patch (Gaia saturates at G ≲ 4) | `ATTRIBUTIONS.md:458`; `buildStars.ts:58` |
| Cosmicflows-4 (Tully 2023) | No licence stated; CDS terms apply | Cite; mark "no licence stated" | `ATTRIBUTIONS.md:336-373` |
| 2MRS (Huchra 2012), GLADE v2.3 (Dálya 2018), Milliquas v8 (Flesch 2023) | No licence stated | Same treatment if we add them | `ATTRIBUTIONS.md:130,216,287` |
| SDSS DR17 | "considered in the public domain" | Credit the collaboration | `ATTRIBUTIONS.md:102-110` |
| Edenhofer et al. 2024 dust | CC BY 4.0, Zenodo doi:10.5281/zenodo.10658339 (v1.0.2) | Cite paper + dataset DOI | `ATTRIBUTIONS.md:860-883` |
| DSS via CDS hips2fits | Copyrighted (STScI terms) | Only if we fetch thumbnails at runtime; credit "Colored & Healpixed by CDS" | `ATTRIBUTIONS.md:1329-1340` |
| Constellation lines (d3-celestial, O. Frohn) | BSD-3-Clause | Keep the notice if vendored | `ATTRIBUTIONS.md:704-722` |
| Freudenreich 1998 (MW model), Reid 2019 | Papers | Cite as "modelled" content, never as data (skymap's measured/derived/modelled split, `docs/science.md:34-46`, is a good UI convention to copy) | — |
| skymap itself | MIT; Zenodo doi:10.5281/zenodo.20037028 (`CITATION.cff:13`) | Cite in prior-work and in any ported file's header | `LICENSE:1-3` |

**How to present attributions.** Copy skymap's ATTRIBUTIONS format: one entry per source with
What / By / Licence (verbatim quote) / Use class (free with credit, non-commercial only, no licence
stated) / Attribution / Upstream / Enters-our-pipeline / Modified / Checked date. Generate it from
our per-layer `PROVENANCE.json` instead of writing it by hand.
