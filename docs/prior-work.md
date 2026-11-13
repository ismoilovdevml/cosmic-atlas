# Prior work: browser maps from the Sun to the cosmic web

Research date: **2026-11-13**. Every row below was checked against a source I opened that day
(project page, GitHub repo or API, paper, or a direct data query). Anything I could not confirm is
marked *unverified*. "Last update" is the most recent date I could see: the GitHub `pushed_at` date
from the API, a dated release note, or a page date.

## Claim under test

> There is no browser-based, Google-Maps-like 3D map (search + toggleable layers) built on the
> latest data that takes you seamlessly from the Sun to nearby stars (Gaia, ~1.8 bn stars), to the
> Milky Way and the Local Group, and out to the cosmic web (DESI galaxies).

**Verdict: false as worded.** At least two live browser apps already offer a continuous zoom from
the Solar System to the cosmic web, with name search, toggleable layers, Gaia DR3 stars and DESI DR1
galaxies: **skymap** (open source, MIT, commits almost daily) and **Space Time** (Point Dynamics,
closed source). **Lightcone** is a third, but it has no search. The claim holds only in a narrower
form, which is stated precisely under "The real gap" below.

---

## 1. Comparison table

### 1a. Browser apps that already cover most of the claim (all launched in 2026)

| Tool | Web? | Data (release, count) | Scale range | Search | Layers | Open? | Last update | Link |
|---|---|---|---|---|---|---|---|---|
| **skymap** (R. Rulkens) | Yes, WebGPU (Chrome/Edge 113+, Firefox 141+, Safari 26+) | Gaia DR3 **16.8 M** stars plus GCNS and Hipparcos-2; about **3 M** galaxies from SDSS DR17 (about 500k), 2MRS, GLADE v2.3 and Milliquas v8; **DESI DR1 LSS cones/slices** (off by default); CF-4 density and CF4++ flow field; MCPM cosmic-web VAC; DisPerSE filaments; MCXC/MSCC structures | Earth's surface (1e7 m) to the observable horizon (1e26 m), "in a single scene with no scale breaks" | Yes. Cmd+K over a famous-object atlas, 48,000 PGC aliases and named structures; deep links (`#focus=`, `#tour=`) | Yes. A Settings panel toggles DESI cones, CF4 flow, constellations and the CF-4 volume; galaxy LOD goes dot → procedural disk → thumbnail | **MIT** code; data under mixed terms | last commit 2026-11-12 (repo created 2026-05-04) | https://github.com/rulkens/skymap · https://skymap.rulkens.com |
| **Space Time** (Point Dynamics) | Yes, WebGL 2 | Stars: Tycho-2, HYG and Gaia (release not stated on the main page; Gaia DR3 cluster members per the 2026-08-10 note), "2.5 million mapped stars"; galaxies: **631,000 DESI DR1** galaxies and quasars (2026-07-29 note), 2MRS (43,530); 32,000+ deep-sky objects; Planck 2018 CMB | Planet surfaces → stars → Milky Way → clusters → "the observed cosmic web" | Yes. Search, fly-to, and a 97-entry destination atlas | Partial. Sky cultures, live-data toggles, atlas filters; no full layer panel described | **No licence stated (closed)** | release 2026-11-11 | https://space.pointdynamics.com · https://space.pointdynamics.com/whats-new/ |
| **Lightcone** (M. Varma) | Yes, static app | 2.8 M points: **1.9 M DESI DR1** galaxies and QSOs, 500k Milliquas v8, 328k ATHYG v3.2 stars (Gaia DR3-derived), 78k CF4 + 2MRS; Legacy Surveys DR11 imagery; DESI spectra fetched live from SPARCL | Sky photograph → "Depth · 3D" unfold of the same sightline into the cosmic web; nearby stars; quasars | No search visible | Tabs for Stars / Nearby / Cosmic web / Quasars, a time lens, and a tour | No licence file | 2026-08-22 | https://github.com/muraliavarma/lightcone · https://lightcone.murlax.com |
| Cosmoscope (Galactic AI Team) | Yes, live on Vercel | "HYG/Gaia subset" (count not stated); "Milky Way, Local Group, sampled cosmic web" | Solar System → stars → Milky Way → galaxies → cosmic web | Yes (`flyTo` by id) | Yes (ScaleLayer registry with crossfades) | No licence | 2026-11-02 | https://github.com/galactic-ai-team/cosmoscope |
| Amadeus Universe | Yes | Gaia DR3 (count not stated), HYG v3.8, OpenNGC, Hubble Messier, exoplanets, pulsars; **no DESI or SDSS** | Surface → Milky Way → "Beyond" | Yes ("/" key, find & fly) | Yes (display and catalogue layers) | Not stated | catalogue snapshot 2026-09-15 | https://www.amadeusuniverse.com |
| Cosmic Web Atlas (Samyak-jain7) | Yes, but local only (no live URL) | HYG v4.1 109,400 stars; LVDB 911 galaxies + 213 globular clusters; OpenNGC; SDSS DR8 / NSA 704,990 galaxies | Earth → observable universe | No | Yes (sketches, simulated web) | No licence | 2026-10-09 (1 commit) | https://github.com/Samyak-jain7/cosmic-web-atlas |
| starmap (ritesh59697) | Yes, local only | 1,012,490 Gaia DR3 stars (G<11); 6,330 GWGC galaxies; procedural Milky Way | Solar System → Virgo, in 4 tiers that crossfade | No | Tier buttons | MIT | 2026-08-14 | https://github.com/ritesh59697/starmap |
| Universe Experience Platform | Yes, three.js + FastAPI | ≤6,000 Gaia DR3 stars, 9,000 2MRS galaxies, otherwise procedural | Earth → CMB | No (tour) | 9 layers labelled "evidence-aware" | MIT (badge) | 2026-07-10 | https://github.com/demetacrypto/universe-experience-platform |
| Cosmic Map (rubenmendoza1290) | Yes, local only | 2MRS (about 43k) + CF4 (about 56k) + named superstructures | Local universe only | No | Yes | NOASSERTION | 2026-07-26 | https://github.com/rubenmendoza1290/cosmic-map |

### 1b. Older or established browser tools

| Tool | Web? | Data | Scale range | Search | Layers | Open? | Last update | Link |
|---|---|---|---|---|---|---|---|---|
| **WorldWide Telescope** web client / WebGL engine, 3D mode | Yes | I checked the engine source and the CDN files myself. Stars: **Hipparcos, 117,955 rows** (`catalog.aspx?Q=hipparcos`). Galaxies: **SDSS "Cosmos", 431,263 records** (`Q=cosmosnewbin`, 25-byte records). The Milky Way is a textured image (`milkywaybar.jpg`). No Gaia. | Solar System → nearby stars → Milky Way → "other galaxies" (worldwidetelescope.org) | Yes (sky mode) | Yes (layer manager) | MIT | engine pushed 2026-11-13 | https://github.com/WorldWideTelescope/wwt-webgl-engine |
| **Firefly** (Gurvich & Geller 2023, ApJS 265, 38) | Yes, WebGL | Demo of the **full Gaia DR3 octree, "1.5 B points, streamed"**; separate SDSS and FIRE demos | One dataset per instance. No Sun → cosmic-web chain. | Filters only; no name search | Filters, colourmaps, vector fields | AGPL-3.0 | repo pushed 2026-10-30 | https://firefly.rcs.northwestern.edu · arXiv:2207.13706 |
| Lactea (Alghamdi et al., EuroVis 2025, CGF 44(3)) | Yes, WebGPU | Gaia DR3 with XP spectra, "almost 2 billion stars", in a multi-resolution tree of 1,000 stars per node | View type (3D fly or sky) *unverified* | No | Spectral tasks | GPL-3.0 | 2025-06-05; no live demo | https://github.com/vccvisualization/lactea |
| 100,000 Stars (Google Data Arts) | Yes | HYG, 119,617 stars | Nearby stars only | No | No | Not stated | 2012 | https://web.dev/case-studies/100000stars |
| Celestiary | Yes | 106,747 stars, 9 planets | Solar System + local stars | No | Minimal | No licence | n/a | https://celestiary.github.io |
| Celestia Web | Yes ("lite version … for demonstration purposes only") | Celestia default data | Solar System → stars | Unverified | Unverified | GPL-2.0 (Celestia) | Celestia repo pushed 2026-11-11 | https://celestia.mobi/download |
| NASA Eyes on Exoplanets | Yes | 4,716 exoplanet host stars | Solar System → exoplanet hosts / galaxy overview | Yes | Limited | Proprietary (NASA) | release notes 2026-05 | https://science.nasa.gov/blogs/eyes/ |
| Stellarium Web | Yes | Gaia ("more than 1 billion stars") | **Planetarium sky view, not a 3D fly-through** | Yes | Yes | AGPL-3.0 (engine) | 2026-11-05 | https://github.com/Stellarium/stellarium-web-engine |
| Gaia Sandbox WebGL ports | Yes (2016) | Tycho-2 (focal-plane spinoff) | Old ports; author noted Safari and mobile problems | n/a | n/a | n/a | 2016 | https://tonisagrista.com/blog/2016/gaia-sky-gaia-image-week/ |

### 1c. 2D sky atlases: a solved problem, but not 3D

| Tool | Web? | Data | Scale | Search | Layers | Open? | Last update | Link |
|---|---|---|---|---|---|---|---|---|
| HiPS (IVOA standard) | Format | HiPS 1.0 is an IVOA Recommendation (2017-05-19). **HiPS3D** (2025–26 drafts) adds a *spectral* axis for cubes, **not a distance axis** | 2D sky tiles | n/a | n/a | Open standard | HiPS3D slides Nov 2025 | https://www.ivoa.net/documents/HiPS/ · https://wiki.ivoa.net/internal/IVOA/InterOpJune2025Apps/HiPS3D-IVOA25-Fernique.pdf |
| Aladin Lite v3 | Yes, WebGL2 | Any HiPS plus catalogue HiPS ("progressive catalogues") | 2D sky. HiPS3D (cubes) is still unchecked in the README checklist. | Yes | Yes | LGPL-3.0 | 2026-11-05 | https://github.com/cds-astro/aladin-lite |
| ESASky / ESO / ALMA portals | Yes | All built on Aladin Lite ("powers … ESASky, ESO Science Archive portal and ALMA Portal"); ESASky v7.9 released 2026-06-24 | 2D | Yes | Yes | n/a | 2026-06-24 | https://www.cosmos.esa.int/web/esdc/esasky-release-notes |
| Legacy Survey Sky Viewer | Yes | Imaging + catalogues; **DR11 = 3,920,661,806 unique sources** (DR10 about 2.8 bn) | 2D | Yes | Yes (incl. DESI overlays; overlays *unverified*) | n/a | DR11 v11.0.2 | https://www.legacysurvey.org/viewer · https://d.legacysurvey.org/dr11/description |
| Map of the Observable Universe (Ménard & Shtarkman, JHU) | Yes | about 200,000 SDSS galaxies and quasars | A **2D slice about 10° thick**, scrolled outward | No (clicks show no details) | No | n/a | 2022 | https://mapoftheuniverse.net |
| Google Sky | *unverified* (current status not confirmed) | — | 2D | — | — | — | — | — |

### 1d. Single-dataset viewers (DESI, Cosmicflows, dust)

| Tool | Web? | Data | Notes | Open? | Last update | Link |
|---|---|---|---|---|---|---|
| desi3d (D. Kirkby) | Yes | about 30,000 galaxies from "proprietary DESI data" (pre-DR1) | BGS/LRG/ELG/QSO toggles; cosmology sliders | n/a | undated | https://dkirkby.github.io/desi3d |
| DESI-DR1-Map-Explorer | **No** (Python desktop) | Full DR1, about 18 M galaxies + QSOs | Fly-through, picking, 6 colour modes, LOD | No licence | 2026-08-02 | https://github.com/itsRevela/DESI-DR1-Map-Explorer |
| MeesaJarJar Universe | Local web app (Node) | "16.8 million" DESI DR1 objects | N-body toy, k-NN web lines | MIT | 2026-04-17 | https://github.com/MeesaJarJar/Universe |
| DESI "Galactic Constellations" | Yes | DESI DR1 slices 2° wide in Dec | Companion to arXiv:2603.29912 | n/a | 2026-10-25 | https://github.com/cmlamman/galactic-constellations |
| Pomarède / Cosmicflows Sketchfab models | Yes (Sketchfab) | Cosmicflows-3 scenes (V-web, South Pole Wall, Local Void, NAM orbits) | Each model is a fixed scene; no catalogue browsing | CC BY (models) | 2017–2020 | https://sketchfab.com/3d-models/the-south-pole-wall-656f5663266c4d2d914e0fdbd1237022 |
| laniakea (CF4 cosmography) | **No** (pygfx/wgpu desktop) | CF4 table, basin-of-attraction grid | v1.0.0, March 2026 | MIT | 2026-03 | https://github.com/manlius/laniakea |
| G-Tomo-3D (EXPLORE) | Self-hosted Dash/plotly | Lallement/Vergely 2022 Gaia-2MASS extinction cubes | Docker install; no public instance found | Apache-2.0 | n/a | https://awesome.ecosyste.ms/projects/github.com%2Fexplore-platform%2Fg-tomo-3d |
| MilkyWay3D.org (Zucker, Goodman, AMNH) | Hub (Google Sites) | Planned 3D-Milky-Way data and tools | Demos page has no viewer listed yet | "open-data, open-source" (stated) | undated | https://sites.google.com/view/milkyway3d/home |
| Edenhofer 2024 dust map | No web viewer found | 3D dust from 69 to 1,250 pc, built from 54 M Gaia XP stars | Data only | — | 2024 | arXiv:2308.01295 |
| Uchuu / IllustrisTNG | No browser 3D viewer verified | Uchuu: movies and VR on the outreach page. TNG: a 2019 news item mentions a "Google-Map-like" interface; its current state is *unverified* | — | — | — | https://skiesanduniverses.iaa.es/Simulations/Uchuu/Outreach · https://www.mpia.de/en/news/2019-05-tng |

### 1e. Desktop: these already do the full claim, just not in a browser

| Tool | Web? | Data | Scale | Search | Layers | Open? | Last update | Link |
|---|---|---|---|---|---|---|---|---|
| **Gaia Sky** (ARI Heidelberg) | **No.** Desktop and VR. No current web build found (only the 2016 WebGL ports). | Gaia DR3 LOD catalogues up to **1.47 B stars** ("Gaia DR3 bayesian distances", 109.3 GiB), plus subsets (fidelity 393.7 M, RUWE 957.8 M, default 15.1 M, …); **SDSS DR18 3.64 M** galaxies; NEARGALCAT 875; Gaia DR3 dust iso-density, HII and star-density maps | Solar System → Milky Way → SDSS | Yes | Yes (dataset manager) | MPL-2.0 | 3.6.11 (2025-07-28); repo pushed 2026-11-12 | https://gaiasky.space/resources/datasets/ |
| **OpenSpace** (AMNH / Linköping / NYU / Utah) | **No.** Desktop only; the site mentions no web version. | Gaia DR2 octree streaming (7.2 M default; 618 M filtered; full DR2); stars asset cites Gaia DR3 + XHIP; SDSS galaxies; Digital Universe atlas | Planet surfaces → observable universe | Yes | Yes | MIT | 0.22.0 (2026-06-09) | https://docs.openspaceproject.com/latest/building-content/gaia.html |
| Celestia | Desktop (a web lite demo exists, see 1b) | Hipparcos-era stars and its own galaxy set | Solar System → galaxies | Yes | Yes | GPL-2.0 | 2026-11-11 | https://github.com/CelestiaProject/Celestia |
| SpaceEngine | Desktop, paid | Real catalogues **plus procedural fill** | Full universe | Yes | Yes | Proprietary | n/a | https://alternativeto.net/software/space-engine/ |
| Universe Sandbox | Desktop | Gravity simulator, not a catalogue map | n/a | — | — | Proprietary | n/a | https://wikipedia.com/wiki/Universe_Sandbox |

---

## 2. What already exists (verdict)

The "Google Maps of the universe in a browser" idea is **already built, and was built many times
in 2026**. Most of these projects look like single-author builds (several are probably AI-assisted)
with 0–14 GitHub stars. The strongest is **skymap**. It is MIT-licensed, has a live WebGPU site,
1,794 commits and a Zenodo DOI (10.5281/zenodo.20037028). It goes in one scene from Earth's surface
to the observable horizon, with Cmd+K search over 48k PGC aliases and a settings panel of layers. It
already uses Gaia DR3 + GCNS, SDSS/2MRS/GLADE, DESI DR1 slices, CF-4 density and flows, and a
cosmic-web density VAC. **Space Time** (closed source, released almost daily) does the same with
631k DESI DR1 objects and 2.5 M stars. **Lightcone** shows 1.9 M DESI DR1 objects in 3D, with live
SPARCL spectra. On the desktop, **Gaia Sky** and **OpenSpace** have done the whole chain for years,
including LOD catalogues of up to 1.47 B Gaia stars. Anyone who reads the claim and finds skymap
will rightly call it false. The 2D sky (HiPS / Aladin Lite / ESASky / Legacy Viewer) is a solved
problem and is not our target.

## 3. The real gap (precise)

None of the browser apps streams **full** catalogues across the whole scale range. Every one of them
shows a curated subset of a few million points or fewer:

| | Stars in the cross-scale browser app | DESI DR1 in the cross-scale browser app |
|---|---|---|
| skymap | 16.8 M (Gaia DR3, G < 14, d < 12 kpc). Stars already stream from a chunked octree (SKOI/SKOC, docs/DATA.md:29,187); the README's "spatial chunking" future-work item refers to galaxies, which are still whole-file tiers (see docs/skymap-lessons.md). | DR1 LSS cones/slices only, off by default |
| Space Time | about 2.5 M | 631k |
| Lightcone | 328k | 1.9 M |
| **Full catalogue** | **1.47 B** with Bailer-Jones distances (1.81 B rows in DR3); **about 2.0 B** in DR4 `gaia_source` | **18.7 M** (13.1 M galaxies, 1.6 M QSO, 4.1 M stars) |

Full-catalogue streaming in a browser does exist, but **only in isolation**: Firefly's Gaia DR3
octree demo (1.5 B points) and Lactea (WebGPU research prototype). Neither is cross-scale, neither has
name search, and neither has extragalactic layers. Full DESI DR1 exists only in desktop and local
tools (DESI-DR1-Map-Explorer, MeesaJarJar).

So the defensible niche is this:

> **One out-of-core, streamed LOD scene in the browser that carries complete catalogues:** Gaia
> (1.47 B stars with Bailer-Jones distances, then DR4 at about 2.0 B), the full DESI DR1 (18.7 M),
> the Local Group / Local Volume (LVDB, UNGC) and the Edenhofer/Vergely 3D dust. It also needs
> **per-object pick records** (source_id/targetid, distance percentiles), **distance uncertainty
> shown**, a reproducible pipeline with provenance, and early **Gaia DR4 support** (DR4 is out
> 2026-12-02).

No surveyed browser app shows distance uncertainty. OpenSpace's 0.20.1 changelog is reported to add
"Star Distance Uncertainty" on the desktop, but I saw that only in a search summary (*unverified*).

**Two honest caveats that weaken the niche:**

1. **More points do not make a better map at large scale.** Of DR3's 1.81 B sources, only 1.47 B
   have parallaxes or geometric distances (1.35 B photogeometric). For most of those, the distance
   beyond a few kpc is dominated by the Galaxy-model **prior** that Bailer-Jones et al. 2021 used.
   A "Milky Way" drawn from 1.47 B stars partly redraws the prior. The yage.ai Gaia essay found the
   same thing: no spiral arms, because parallaxes are reliable only to a few thousand light years.
   Gaia Sky ships "fidelity" (393.7 M) and "RUWE" (957.8 M) cuts for this reason.
2. **skymap is open source and moving fast**; its stars are already chunked and galaxy chunking is on its roadmap. If it
   adds chunking, most of this niche closes. Two options are worth weighing: (a) contribute an
   out-of-core star/galaxy tiler to skymap, or (b) build our own and differentiate on completeness,
   uncertainty, DR4 at launch and the open tile format plus pipeline.

## 4. Data prior art and access (verified 2026-11-13)

| Catalogue | What it gives | Size | Access | Ref |
|---|---|---|---|---|
| Gaia DR3 `gaiadr3.gaia_source` | ra, dec, parallax, G, BP-RP | **1,811,709,771 rows**. I re-counted this myself, see below. | ESA TAP https://gea.esac.esa.int/tap-server/tap (sync and async); also NOIRLab Data Lab | Gaia Collab. 2023 |
| Bailer-Jones et al. 2021 distances | `r_med_geo`, `r_lo_geo`, `r_hi_geo`, `r_med_photogeo` (16/50/84 %) | 1.47 B geometric, 1.35 B photogeometric | ESA TAP `external.gaiaedr3_distance` (query tested; returns those columns) | AJ 161, 147; arXiv:2012.05220; doi:10.3847/1538-3881/abd806 |
| GCNS (stars within 100 pc) | Clean 100 pc sample with distance posteriors | **331,312** (`SELECT COUNT(*) FROM external.gaiaedr3_gcns_main_1` on ESA TAP) | ESA TAP | A&A 649, A6 (2021); arXiv:2012.02061 |
| **Gaia DR4** | **Released 2026-12-02**; 66 months of data (2014-07-25 to 2020-01-20) | `gaia_source` **2,000,033,276 rows** (586 GB); about 2.8 B sources processed; epoch astrometry 129.6 B rows (62 TB); XP mean spectra 1.82 B; `ap_class` 1.79 B; exoplanet-candidate and RV-orbit tables; about 400 TB in total (DR3 was 10 TB). The content page "is under development" (last update 2026-09-14). DR5 is not before end of 2030. | ESA archive | https://www.cosmos.esa.int/en/web/gaia/dr4 · https://www.cosmos.esa.int/web/gaia/release |
| DESI DR1 | Spectroscopic redshifts | Paper: **18.7 M** (13.1 M galaxies, 1.6 M QSO, 4 M stars). Data Lab: 18,659,804 useful main-survey spectra (13,049,402 galaxies; 1,553,713 QSO; 4,056,689 stars); `desi_dr1.zpix` has 23,060,727 rows. Covers 2021-05-14 to 2022-06-13. | **Data Lab TAP** https://datalab.noirlab.edu/tap (schema `desi_dr1`); **SPARCL** (healpix-coadded spectra only); **NERSC** files via https://data.desi.lbl.gov/doc/access/. Licence CC BY 4.0. | arXiv:2503.14745 |
| DESI DR2 / full survey | DR2 = first 3 years (to 2024-04-09). The 5-year main survey finished April 2026 with **more than 47 M galaxies and quasars** (plus more than 20 M stars). | **Not public.** The DESI releases page lists only EDR (2023-06-13) and DR1 (2025-03-19). One DESI MWS paper says DR2 is "scheduled for release by early 2027". Full-survey cosmology results are expected in 2027. Do not confuse the DR2 BAO *results* (2025-03-19) with a data release. | — | arXiv:2505.17230; https://data.desi.lbl.gov/doc/releases/; https://physics.osu.edu/news/desi-finishes-observations-largest-3d-map-universe |
| 2MRS | All-sky redshifts, Ks ≤ 11.75 | 44,599 input galaxies, 97.6 % complete (about 43.5k with z) | VizieR J/ApJS/199/26 | Huchra et al. 2012, ApJS 199, 26; arXiv:1108.0669 |
| Cosmicflows-4 | Redshift-independent distances | **55,877 galaxies in 38,065 groups** | EDD (edd.ifa.hawaii.edu); VizieR J/ApJ/944/94 | Tully et al. 2023, ApJ 944, 94; arXiv:2209.11238 |
| UNGC (Local Volume) | Distances within 11 Mpc | 869 galaxies (2013); a live LV database at http://www.sao.ru/lv/lvgdb | SAO LV database | Karachentsev et al. 2013, AJ 145, 101; arXiv:1303.5328 |
| McConnachie Nearby Galaxies | Local Group dwarfs within 3 Mpc | Count not on the page. The latest file is `NearbyGalaxies_Jan2021_PUBLIC.fits`, so updates appear to have stopped after Jan 2021. | CADC | McConnachie 2012, AJ 144, 4 |
| **LVDB** (Pace 2024) | Modern successor for LG/LV dwarfs and star clusters; "complete for known dwarf galaxies within ~3 Mpc"; continually updated | GitHub `local_volume_database` | GitHub | arXiv:2411.07424 |
| Edenhofer et al. 2024 dust | 3D dust density, 69–1,250 pc, 516 log distance bins, Nside 256 (14′), 12 posterior samples | From 54 M Gaia XP stars | Zenodo / `dustmaps` | A&A 685, A82; arXiv:2308.01295 |
| Vergely/Lallement 2022 dust | 3D extinction density | 6 × 6 × 0.8 kpc around the Sun (larger low-resolution cubes also exist) | VizieR J/A+A/661/A147, J/A+A/664/A174; G-Tomo | A&A 661, A147; arXiv:2203.01627 |

**Gaia data-access facts I verified myself (ESA TAP, anonymous):**
- The sync endpoint caps results at **50,000 rows**. `SELECT TOP 60000 …` returned 50,000 rows.
- Anonymous queries are killed after **60 s**. A full-table `GROUP BY GAIA_HEALPIX_INDEX(1, source_id)`
  failed on both endpoints: sync gave HTTP 408 "Job timeout/aborted" and async ended `ABORTED` with
  "canceling statement … duration: 60061 ms". So the *unchunked* server-side aggregation the
  coordinator described did **not** work for me.
- What does work is server-side aggregation split by `source_id` range. The `source_id` encodes the
  HEALPix index (`source_id >> 35` is the order-12 nested index), so one `COUNT(*) … WHERE source_id`
  range query per order-1 HEALPix pixel gives 48 queries. The slowest took 22.3 s (pixel 28, 385 M
  rows). They sum to **exactly 1,811,709,771**, the published DR3 total. The same chunking extends
  to `GROUP BY GAIA_HEALPIX_INDEX(k, source_id)` inside each range, for density tiles without
  downloading rows. (Script used: scratchpad `hpx_count.py`; not committed.)
- For bulk extraction, which is needed for the 1.47 B tiles, use the async endpoint with a login or
  the bulk files at https://cdn.gea.esac.esa.int/Gaia/ (bulk files *not* checked this session).
- **Licence:** the Gaia archive says the data are "open and free to use, provided credit is given to
  'ESA/Gaia/DPAC'". The licence page (https://www.cosmos.esa.int/web/gaia-users/license, checked
  2026-11-13) states: "Gaia data are distributed under the CC BY-NC 3.0 IGO license"; commercial use
  goes through the ESA Terms and Conditions. So this project stays non-commercial. DESI DR1 is CC BY 4.0.

## 5. Rendering technology

| Tech | What it is | Fit for us |
|---|---|---|
| **Potree 2.0 / PotreeConverter 2** (Schütz, Ohrhallinger, Wimmer 2020, CGF 39(7), doi:10.1111/cgf.14134) | An octree with an **additive** layered LOD: each node holds a subsample, and parent and children are drawn together. The converter outputs **3 files** (metadata, hierarchy, octree) instead of millions, and the browser reads them with HTTP range requests. Builds at about 6–9 M pts/s. | **Closest match to our data contract** (`r`, `r0`… naming, additive LOD). Consider Potree 2's 3-file layout over one file per node. 1.47 B / 20k is at least 73k nodes, and with `.ext.bin` that means hundreds of thousands of objects. |
| **Gaia Sky magnitude-space octree** (Sagristà et al. 2019, IEEE TVCG 25(1) 1070, doi:10.1109/TVCG.2018.2864508) | The brightest stars go in the upper levels; an octant is drawn when its solid angle exceeds θ; a floating camera keeps single-precision accuracy. | The same idea as our "sort by luminosity before insertion". It is proven at 1.47 B on desktop. |
| OpenSpace Gaia octree | `ConstructOctreeTask` builds the tree, `StreamOctree` streams it, with GPU and CPU memory caps and a pixel threshold | Desktop prior art; full DR2 took about 7 h on 8 threads to read |
| Firefly octree | Progressive loading as the camera moves; 1.5 B Gaia DR3 in a browser | The only verified browser proof at Gaia scale (WebGL) |
| Lactea | WebGPU multi-resolution tree, 1,000 stars per node, chunks of about 5.6 MB | WebGPU compute-accumulation prior art |
| **3D Tiles 1.1** (OGC Community Standard) | Point clouds as glTF (`EXT_mesh_features`, `EXT_structural_metadata`); implicit octree tiling with subtree files; ADD refinement | Interoperable (CesiumJS, deck.gl Tile3DLayer), but heavier per tile, and the geospatial framing (ECEF and so on) is a poor fit. Use it only if interop matters. |
| **COPC** 1.0 (2021) | A LAZ 1.4 file with a clustered octree (EPT-style hierarchy) read by HTTP range requests; point formats 6–8 only | A LiDAR-oriented format (GPS time, scaled-integer LAS coordinates, LAZ decoding in JS). **Not recommended.** |
| deck.gl PointCloudLayer / Tile3DLayer (loaders.gl) | Renders 3D Tiles point tiles; loaders.gl's Potree loader is reportedly v1 only (community thread) | A viable renderer only if we adopt 3D Tiles |
| HiPS / catalogue HiPS / HiPS3D | 2D HEALPix tiles. HiPS3D adds a frequency axis. | Use for the background sky imagery layer only. There is **no distance-axis astronomy LOD standard**. |
| **Relative-to-eye (RTE)** | Cesium's GPU RTE, following AGI's "Precisions, Precisions": double positions split into high and low float32 parts on CPU and GPU, or per-node origins | Our contract's per-node float64 centre minus float64 camera, uploaded as a float32 uniform, is the standard fix. Gaia Sky ("floating camera"), skymap ("floating-origin camera") and Cosmoscope ("float64 world, camera-relative float32") all do it. |
| **Logarithmic depth / reversed-Z** | Cesium 1.45 (2018) replaced multi-frustum rendering with a hybrid of multi-frustum and log depth (near 0.1, far 1e8 in one frustum). skymap uses **reversed-Z** depth on WebGPU. | Points from 1 pc to 1 Gpc span 9 decades. Log depth (our contract) works on WebGL2 and WebGPU but writes `frag_depth`, which disables early-Z. On WebGPU, a reversed-Z float32 depth buffer is cheaper and reaches the same range. |

**Recommendation**
1. Keep the contract's **Potree-style additive octree, sorted by importance**, with RTE per node.
   This is the proven pattern (Potree 2, Gaia Sky, Firefly). Adopt **Potree-2-style consolidated
   files** (one `octree.bin` plus `hierarchy.bin` per layer, read by range requests) before scaling
   past about 10⁸ points.
2. Target **WebGPU first, with a WebGL2 fallback**. Use reversed-Z on WebGPU and log depth on WebGL2.
   skymap and Lactea show WebGPU is ready (Safari 26+ included).
3. Do not adopt COPC. Adopt 3D Tiles 1.1 only if CesiumJS or deck.gl interop becomes a goal.
4. Budget the hosting. At 16 + 16 B per point, 1.47 B Gaia stars come to about 47 GB of tiles. Gaia
   Sky's comparable catalogue is 109.3 GiB. Use an egress-free object store (skymap streams from
   Cloudflare R2).
5. Stage the scale-up: GCNS (331k) → a Gaia DR3 fidelity cut → the full 1.47 B. Ship **DESI DR1
   full (18.7 M)** early; it is the cheapest differentiator against every browser competitor.

## 6. References

**Competing or overlapping tools**
- skymap: https://github.com/rulkens/skymap · https://skymap.rulkens.com · doi:10.5281/zenodo.20037028
- Space Time: https://space.pointdynamics.com · https://space.pointdynamics.com/whats-new/ · https://space.pointdynamics.com/universe-zoom-out/
- Lightcone: https://github.com/muraliavarma/lightcone · https://lightcone.murlax.com
- Cosmoscope: https://github.com/galactic-ai-team/cosmoscope · https://cosmoscope-chi.vercel.app
- Amadeus Universe: https://www.amadeusuniverse.com
- Cosmic Web Atlas: https://github.com/Samyak-jain7/cosmic-web-atlas
- starmap: https://github.com/ritesh59697/starmap
- Universe Experience Platform: https://github.com/demetacrypto/universe-experience-platform
- Cosmic Map: https://github.com/rubenmendoza1290/cosmic-map
- 3d-star-maps (HYG + procedural galaxies): https://github.com/alparslantopbas/3d-star-maps
- WorldWide Telescope WebGL engine: https://github.com/WorldWideTelescope/wwt-webgl-engine · https://worldwidetelescope.org/use/everyone/ · AAS Nova 2017: https://aasnova.org/?p=2805
- Firefly: Gurvich & Geller 2023, ApJS 265, 38, arXiv:2207.13706 · https://firefly.rcs.northwestern.edu · https://github.com/ageller/Firefly
- Lactea: Alghamdi, Hadwiger, Reina, Jaspe-Villanueva 2025, CGF 44(3) · https://github.com/vccvisualization/lactea · https://vccvisualization.org/lactea
- 100,000 Stars: https://web.dev/case-studies/100000stars
- Celestiary: https://github.com/pablo-mayrgundter/celestiary · Celestia: https://celestia.mobi/download · https://github.com/CelestiaProject/Celestia
- NASA Eyes: https://science.nasa.gov/blogs/eyes/
- Stellarium Web Engine: https://github.com/Stellarium/stellarium-web-engine
- Gaia Sandbox WebGL (2016): https://tonisagrista.com/blog/2016/gaia-sky-gaia-image-week/
- Aladin Lite: https://github.com/cds-astro/aladin-lite · README checklist: https://cdn.jsdelivr.net/npm/aladin-lite@3.9.0-beta/README.md
- HiPS 1.0: https://www.ivoa.net/documents/HiPS/ · HiPS3D: https://wiki.ivoa.net/internal/IVOA/InterOpJune2025Apps/HiPS3D-IVOA25-Fernique.pdf
- ESASky release notes: https://www.cosmos.esa.int/web/esdc/esasky-release-notes
- Legacy Surveys DR11: https://d.legacysurvey.org/dr11/description · DR10: https://d.legacysurvey.org/dr10/description
- Map of the Observable Universe: https://mapoftheuniverse.net
- desi3d: https://dkirkby.github.io/desi3d · DESI-DR1-Map-Explorer: https://github.com/itsRevela/DESI-DR1-Map-Explorer · MeesaJarJar Universe: https://github.com/MeesaJarJar/Universe · Galactic Constellations: https://github.com/cmlamman/galactic-constellations, arXiv:2603.29912
- Pomarède & Courtois, Cosmography and Data Visualization: arXiv:1702.01941 · Sketchfab South Pole Wall model (link above)
- laniakea (CF4 pipeline): https://github.com/manlius/laniakea
- MilkyWay3D.org: https://sites.google.com/view/milkyway3d/home
- G-Tomo-3D: https://awesome.ecosyste.ms/projects/github.com%2Fexplore-platform%2Fg-tomo-3d
- Gaia Sky: https://gaiasky.space/resources/datasets/ · https://en.wikipedia.org/wiki/Gaia_Sky · Sagristà et al. 2019, doi:10.1109/TVCG.2018.2864508
- OpenSpace: https://www.openspaceproject.com · https://docs.openspaceproject.com/latest/about/releases/index.html · https://docs.openspaceproject.com/latest/building-content/gaia.html
- yage.ai Gaia essay (no spiral arms from parallax): https://yage.ai/gaia-allsky-en.html

**Data**
- Gaia DR4 contents: https://www.cosmos.esa.int/en/web/gaia/dr4 · Release scenario: https://www.cosmos.esa.int/web/gaia/release
- Gaia licence: https://cosmos.esa.int/web/gaia-users/license
- Bailer-Jones et al. 2021, AJ 161, 147, doi:10.3847/1538-3881/abd806, arXiv:2012.05220
- GCNS: Gaia Collaboration, Smart et al. 2021, A&A 649, A6, doi:10.1051/0004-6361/202039498, arXiv:2012.02061
- DESI DR1: DESI Collaboration 2025, arXiv:2503.14745 · https://datalab.noirlab.edu/desi/ · https://data.desi.lbl.gov/doc/releases/ · https://data.desi.lbl.gov/doc/access/
- DESI DR2 timing: arXiv:2505.17230 · full survey complete: https://physics.osu.edu/news/desi-finishes-observations-largest-3d-map-universe
- 2MRS: Huchra et al. 2012, ApJS 199, 26, doi:10.1088/0067-0049/199/2/26, arXiv:1108.0669
- Cosmicflows-4: Tully et al. 2023, ApJ 944, 94, doi:10.3847/1538-4357/ac94d8, arXiv:2209.11238
- UNGC: Karachentsev, Makarov, Kaisina 2013, AJ 145, 101, arXiv:1303.5328
- McConnachie 2012, AJ 144, 4 · data page: https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/community/nearby/
- LVDB: Pace 2024, arXiv:2411.07424
- Edenhofer et al. 2024, A&A 685, A82, doi:10.1051/0004-6361/202347628, arXiv:2308.01295
- Lallement, Vergely, Babusiaux, Cox 2022, A&A 661, A147, arXiv:2203.01627

**Rendering**
- Schütz, Ohrhallinger, Wimmer 2020, Fast Out-of-Core Octree Generation for Massive Point Clouds, CGF 39(7), doi:10.1111/cgf.14134 · https://github.com/potree/PotreeConverter/
- COPC 1.0: https://copc.io/
- 3D Tiles 1.1 (OGC Community Standard): https://portal.ogc.org/files/100660
- deck.gl Tile3DLayer: https://deck.gl/docs/api-reference/geo-layers/tile-3d-layer · loaders.gl Potree thread: https://github.com/visgl/loaders.gl/discussions/1927
- Cesium logarithmic depth (2018): https://cesium.com/blog/2018/05/24/logarithmic-depth/
- AGI "Precisions, Precisions" (RTE): https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm

**Not verified this session:** Google Sky's status; whether Lactea is 3D or sky-view; Firefly's
Gaia DR3 distance method; the current TNG web explorer; OpenSpace's "Star Distance Uncertainty"
dataset; the DOIs for GCNS, 2MRS, CF4 and Edenhofer (cited from memory and standard journal patterns,
not opened); and the Gaia bulk-file CDN.
