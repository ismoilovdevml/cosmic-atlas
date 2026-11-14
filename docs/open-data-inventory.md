# Open-data inventory

This is the inventory of open datasets that the next build phases work from. It lists every open
dataset that could feed a "Google Earth level" map, from planet surfaces out to the CMB. Research
dates: **2026-11-13 and 2026-11-14**.

Each row was checked against the provider's own page (WebFetch, curl, TAP/API counts, arXiv). Any
row or cell that could not be confirmed says **unverified** and gives the reason. Counts marked
"counted" come from our own queries or line counts, not from the provider's text.

## How to read the tables

- **Size arithmetic.** The DESI tiles we already built measure 618.6 MB for 15.14 M points in 5,295
  files. That is **40.86 B per point**, including octree overhead, with 2,859 points per file
  (render + pick). Tile sizes below are `rows × 40.86 B` unless a row says otherwise.
- **Browser CORS** was tested with
  `curl -s -o /dev/null -D - -r 0-0 -H "Origin: https://example.org" <real data URL>`, or with
  `curl -sI` when that was enough. The cell shows the `Access-Control-Allow-Origin` value: `*`,
  "echoes origin", or **none**.
  - CORS matters only for endpoints the browser calls **live**: tile servers, name resolvers,
    alert APIs.
  - Anything we pre-tile onto our own origin can lack CORS without harm.
- **Priority.**
  - **P0** = the next build phase: high value, accessible now, fits a static-tile budget.
  - **P1** = a later phase.
  - **P2** = nice to have, or blocked.
- **Licence** quotes the provider page. "None stated" means we looked and found no licence text.
- **CDS conditions** (https://cds.unistra.fr/legals/) apply to VizieR copies. They say: "Datasets
  containing only Public Information are distributed under an Open Licence or ODbL … or CC-BY". The
  dataset and "CDS/VizieR" must be cited.

### Two facts that affect everything below

1. **CDS Strasbourg is down or degraded** (SIMBAD, VizieR, cdsarc, TAPVizieR, alasky HiPS). The
   cds.unistra.fr home page, dated 2026-11-09, reports "a cybersecurity incident".
   - Re-checked 2026-11-14: `alasky.cds.unistra.fr/DSS/DSSColor/properties` → **404**.
     `skies.esac.esa.int/DSSColor/properties` → **206, ACAO `*`**.
   - Working mirrors:
     - VizieR: **vizier.idia.ac.za**, **vizier.cfa.harvard.edu** (`asu-tsv`, ACAO `*`).
     - SIMBAD: **simbad.harvard.edu** (TAP, ACAO `*`, data to 2026-10-14).
     - Sesame: redirects to IDIA (ACAO `*`).
     - Sky HiPS: **skies.esac.esa.int**, CASDA, China-VO, MAST S3.
     - Planet HiPS: **padc-web.obspm.fr**.
     - CDS mirror list: https://cds.unistra.fr/hips_available_20261109.html.
   - **Never hard-code a single CDS host.**
2. **No JPL API sends CORS** (Horizons, SBDB). The same goes for the main catalogue services:
   ESA Gaia TAP, NOIRLab Data Lab TAP, NED, IRSA, the DESI file server and EDD. So nearly all
   catalogue data must be pre-tiled or snapshotted at build time.

---

## 1. Stars and Galaxy structure

| dataset (release/version) | what it adds to the map | rows/objects or resolution | download/tile size | licence (exact) | access method (endpoint) | browser CORS | 3D-capable? | priority | notes |
|---|---|---|---|---|---|---|---|---|---|
| **Gaia DR3 + Bailer-Jones 2021 distances (full)** | The whole stellar Milky Way, not only d < 1 kpc | 1,467,744,818 geometric; 1,346,621,631 photogeometric (BJ page). DR3 has 1,811,709,771 rows | **Full (16+24 B): 1.4677e9 × 40.86 B ≈ 60.0 GB in ≈ 513k files.** Render-only (16 B): ≈ 24.0 GB in ≈ 257k files. Photogeometric only: 55.0 GB | Gaia: "Gaia data are distributed under the CC BY-NC 3.0 IGO license". BJ table on GAVO: "Creative Commons Attribution 4.0" | ESA TAP `external.gaiaedr3_distance` (https://gea.esac.esa.int/tap-server/tap). GAVO TAP `gedr3dist.main` (https://dc.g-vo.org/tap). GAVO full dump: one 38 GB gz (125 GB CSV) | ESA TAP: none (OPTIONS 403). GAVO: echoes origin | yes | **P1** (once hosting moves, §7) | 60× the 1 GB Pages limit. Beyond a few kpc the distances are dominated by the BJ prior (see prior-work §3). Anonymous ESA TAP returned **HTTP 429** (50-job queue) all through 2026-11-13 |
| Gaia DR3 bulk files (ESA CDN77) | Input for the full build, with no TAP limits | 3,386 `csv.gz` in `gdr3/gaia_source/` | **753,025,885,406 B (753 GB)** summed from the S3 listing | Points to the Gaia licence (CC BY-NC 3.0 IGO) | https://cdn.gea.esac.esa.int/Gaia/ (listing at gaia.eu-1.cdn77-storage.com) | `*`, Range 206 | n/a (BJ distances are not on the CDN; join from GAVO) | P1 (input) | Measured from Tashkent: **3.6 MB/s** (8 MB range, Copenhagen PoP). `Gaia/gdr4/` already exists and is empty |
| GCNS (EDR3, ≤ 100 pc) | A clean, complete 100 pc sample with posteriors | 331,312 (ESA TAP count, prior-work) | 13.5 MB | Gaia licence (inferred) | ESA TAP `external.gaiaedr3_gcns_main_1`; VizieR J/A+A/649/A6 | IDIA VizieR `*`; ESA none | yes | P1 | Mostly inside our d < 1 kpc layer already. Ship as a toggle. Re-count blocked by the 429 |
| **Gaia DR4** | The next base layer: 2.0 B sources, 66 months of data, epoch astrometry, orbits | `gaia_source` 2,000,033,276 rows; ≈ 400 TB in total. Example tables: vari_rrlyrae 246,380; vari_eclipsing_binary 2,392,500; ap_xp 999,939,280 | If every source had a distance: 2.0e9 × 40.86 B ≈ **81.7 GB** | Not yet stated for DR4. Expected CC BY-NC 3.0 IGO (unverified) | ESA archive TAP + CDN from release day | n/a until release | **No distance table is listed** on /dr4 | P1 (after release) | Release page: "Gaia DR4 … **2 December 2026**" (12:00 CET per TU Dresden). `cluster_members`/`cluster_means` "Expected in 2027". DR5 "not before the end of 2030". **No Bailer-Jones DR4 distance paper on arXiv** (author search since 2025-06 returned 0), so its timing is unknown. To find out: watch arXiv `au:Bailer_Jones`, GAVO `gdr4*` schemas and ESA `external.*` after 2026-12-02, and check the DR4 datamodel for GSP-Phot distances (DR4 lists `mcmc_samples_gsp_phot`, 998,981,564 rows, so DPAC distances for ~1 B sources are likely; unverified). docs/prior-work.md says "Released 2026-12-02"; that release is still in the future |
| Hipparcos-2 (I/311) | Bright stars Gaia saturates on | 117,955 | `hip2.dat.gz` 8,977,907 B; tiles ≈ 4.8 MB | None stated (CDS conditions) | VizieR I/311; CfA mirror `ftp/cats/I/311/` | CfA ftp: none | yes (parallax) | done | Already built |
| Tycho-2 (I/259) | 2.5 M bright stars, **no parallax** | 2,539,913 + 18,734 supplement | ≈ 161 MB gz | None stated (CDS conditions) | CfA mirror `ftp/cats/I/259`; Gaia `tycho2tdsc_merge_best_neighbour` | none | no | P2 | Gaia supersedes it |
| LAMOST DR11 v2.0 (international, 2025-09-25; DR12 is domestic) | [Fe/H] and Teff to colour Gaia stars | 25.08 M spectra; ≈ 10.49 M parameter sets | `dr11_v2.0_LRS_stellar.fits.gz` 1,151,416,719 B | Data may be "used freely, but should include the following acknowledgment" (no licence name) | https://www.lamost.org/dr11/v2.0/catdl?name=… | echoes origin | via Gaia cross-match | P2 | Attribute join only |
| APOGEE DR17 | IR stellar parameters (disc/bulge) | "over 650,000 stars" | allStar 3,970,621,440 B | SDSS: "All SDSS data released in our public data releases are considered in the public domain" (sdss.org/collaboration) | data.sdss.org/sas/dr17/apogee/… | none | via Gaia / astroNN | P2 | Superseded by MWM Astra |
| SDSS-V MWM DR19/DR20 (Astra 0.6.0 / 0.8.1) | Stellar parameters plus an **astroNN distance** table | DR20: "over 3 million spectra of 1.5 million stars" (arXiv:2607.26149) | astraAllStarAstroNNdist 534,769,970 B | SDSS public domain (as above) | data.sas …/dr20/spectro/astra/0.8.1/summary/ | none | yes (astroNN) | P2 | Per-table star counts not verified |
| GALAH DR4 | High-resolution abundances (south) | 917,588 stars | allstar 757,998,720 B | None stated (ASTRO 3D acknowledgement only) | cloud.datacentral.org.au/teamdata/GALAH/public/GALAH_DR4/ | none | yes (VAC carries BJ21) | P2 | Overlay only |
| **Hunt & Reffert 2023/2024 open clusters** | Every Gaia cluster with XYZ, mass and bound/unbound class | **7,167 clusters** (counted); **1,291,929 member rows** (counted) | Clusters < 1 MB. Members as points: 1.29 M × 40.86 B = **52.8 MB** | None stated (CDS conditions) | VizieR J/A+A/686/A42 (`clusters`, `members`), IDIA mirror | IDIA `*` | **yes** (`X,Y,Z` pc, `dist50`) | **P0** | Members can tag existing Gaia points |
| **Baumgardt Galactic GC database** (4th version, Mar 2023; table updated 2026-01-20) | All Milky Way globular clusters with distance and orbit | Page: 168 GCs. `orbits_table` 165 rows; `combined_table` 167 rows | 43 kB + 49 kB | No licence: "(C) Holger Baumgardt" | https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt | none | **yes** (Rsun ± ΔR, X/Y/Z) | **P0** | Ask permission if we redistribute the table verbatim |
| OB associations (Quintana+ 2026, MNRAS, doi:10.1093/mnras/stag853) | Young-star structure within 1 kpc | 56 associations (arXiv:2512.05854 abstract; v1 said 57) | small | **unverified** | Data location **unverified** | — | yes | P1 | Find the table first |
| **galstreams v1.2.1** (2026-06-03) | Stellar-stream tracks through the halo | ">200 stream tracks corresponding to 141 distinct stellar streams"; 438 track files | 78,293,008 B ECSV; a few MB after decimation | **BSD-3-Clause** | github.com/cmateu/galstreams (raw files) | raw.githubusercontent `*` | **yes** | **P0** | Draw as polylines |
| **Radcliffe Wave** (Alves+2020; Konietzka+2024) | The 2.7 kpc gas wave as a 3D curve, plus its clusters | 1,600-point model; 125 clusters with xyz+v | < 0.2 MB | **CC0 1.0** (Dataverse) | Dataverse doi:10.7910/DVN/OE51SZ, F98QHY, XSCB9N, K16GQX | `*` (303 → S3) | **yes** | **P0** | Tiny, strong story |
| **Zucker 2020 molecular-cloud distances** | Labelled local clouds | 326 sightlines, 94 clouds (counted) | 55,870 B | **CC0 1.0** | Dataverse doi:10.7910/DVN/07L7YZ (+ 3D skeletons YQYBRD, NMRLP1) | `*` | **yes** (d16/50/84, xyz) | **P0** | Pairs with the dust volume |
| **WISE Catalog of Galactic HII Regions V3.0** (July 2026) | Star-forming regions; the spiral-arm tracer | 8,589 objects; **1,435 with distances** (153 parallax) | CSV 2,842,582 B | **None stated** | http://astro.phys.wvu.edu/wise/catalog/WISE_HII_V3.0.csv | none | partial (1,435) | **P0** (distance subset) | V3.0 is newer than 2.x. Distances are mostly kinematic, so label them that way |
| **Edenhofer+2024 3D dust** v1.0 | Volumetric dust: Local Bubble, cloud complexes | HEALPix Nside 256 × 516 log bins, 69–1,250 pc. **XYZ cube 1251³ at 2 pc** (±1250 pc), float32 MEAN+STD. 2 kpc variant: 1001³ at 4 pc | Zenodo record total 122.67 GB. `mean_and_std_xyz.fits` 15,662,543,040 B. **Browser uint8:** 256³ = 16.8 MB (9.8 pc voxels); 512³ = 134 MB; **512×512×128 (±312 pc in z) = 33.6 MB** | **CC BY 4.0** (Zenodo) | https://zenodo.org/api/records/8187943/files/{name}/content (Range OK) | `/api/…/content`: `*` (re-checked 2026-11-14); `/records/…?download=1`: none | **yes** (native 3D) | **P0** | Pre-bake log-scaled MEAN into a 3D texture (or a 3D-texture brick octree). Compression not measured. Units: "E of Zhang, Green, and Rix (2023)" |
| Vergely 2022 (J/A+A/664/A174) / Lallement 2022 (J/A+A/661/A147) | Dust out to 5 kpc at lower resolution | 10 pc: 601×601×161 (3×3×0.8 kpc). 25 pc: 601×601×81 (6×6×0.8). **50 pc: 501×501×41 (10×10×0.8 kpc)** | 232.6 MB / 117 MB / **41 MB (10.3 MB as uint8)** | None stated (CDS conditions) | `cdsarc …/J/A+A/664/A174/fits/` (**unreachable today**; file list read via IDIA) | FITS untested | **yes** | P1 | Outer shell around Edenhofer. Download waits for CDS |
| Gaia DR3 variability (`vari_*`) | RR Lyrae/Cepheid halo tracers, LPVs, EBs | 10,509,536 variables (RRL 271,779; Cep 15,021; LPV 1,720,588; EB 2,184,477) | All: 429 MB. RRL + Cep: 11.7 MB | CC BY-NC 3.0 IGO | ESA TAP `gaiadr3.vari_*`; CDN `gdr3/Variability/` | CDN `*`; TAP none | via BJ join | P1 | Class tags on existing points are nearly free |
| AAVSO VSX (2026-10-18) | Variable-star names | 10,305,140 rows (HEASARC TAP count) | — | **unverified** (aavso.org returns 403 to our fetcher) | VizieR B/vsx; HEASARC TAP `aavsovsx` | HEASARC none | no | P2 | Mostly duplicates Gaia vari |
| ATNF Pulsar Catalogue v2.9.0 | Neutron stars in 3D | 4,503 pulsars (counted); 458 with independent distance; 420 with parallax | 1,249,005 B tarball | Software GPL v3; no data licence stated | https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.tar.gz | none | yes (mostly YMW16 DM model) | P1 | Flag model distances |
| Green SNR catalogue (2024-Oct; VizieR VII/297) | Supernova remnants | 310 SNRs | tiny | None stated (citation request) | mrao.cam.ac.uk/surveys/snrs/ | none; IDIA `*` | **no distance column** | P2 | Needs a separate distance compilation |
| **NASA Exoplanet Archive `pscomppars`** | Planet hosts | 6,470 planets; 4,862 hosts; 6,442 with `sy_dist` (live TAP) | < 1 MB | No licence; acknowledgement + Christiansen+2025 citation | https://exoplanetarchive.ipac.caltech.edu/TAP/sync | none | yes | **P0** | Refresh at build time |
| Gentile Fusillo+2021 white dwarfs | WD population | ≈ 359k high-confidence | 14.7 MB | None stated (CDS conditions) | VizieR J/MNRAS/508/3877 | IDIA `*` | yes | P1 | Tag existing points |
| Reylé+2021 10 pc sample (update 2023-08-25) | Complete nearest systems incl. brown dwarfs | 540 objects in 339 systems | tiny | None stated (CDS conditions) | VizieR J/A+A/650/A201 | IDIA `*` | yes | P1 | Fills bright and brown-dwarf gaps |
| Gillessen+2017 S-stars | Orbits around Sgr A* | 40 orbits | tiny | None stated (CDS conditions) | VizieR J/ApJ/837/30 | IDIA `*` | yes (elements) | P2 | Deep-zoom easter egg |
| Reid+2019 maser parallaxes | Spiral-arm skeleton from real parallaxes | ~200 regions | tiny | None stated (CDS conditions) | VizieR J/ApJ/885/131 | IDIA `*` | yes | P1 | Our Milky Way model already uses Reid 2019 |
| LVDB v1.1.2 (Pace, 2026-11-04) | Local Group / Local Volume dwarfs and GCs | `comb_all.csv` 1,733 rows (counted) | 838,579 B | **CC0-1.0** | github.com/apace7/local_volume_database (raw CSV) | raw.githubusercontent `*`; release asset none | yes (DM ± err) | **P0** | Replaces McConnachie, which stopped in Jan 2021 |

## 2. Extragalactic

| dataset (release/version) | what it adds to the map | rows/objects or resolution | download/tile size | licence (exact) | access method (endpoint) | browser CORS | 3D-capable? | priority | notes |
|---|---|---|---|---|---|---|---|---|---|
| DESI DR1 (2025-03-19) | Main galaxy/QSO backbone | 15.14 M after our cuts (`zpix` 23,060,727) | 618.6 MB (built) | CC BY 4.0 | Data Lab TAP `desi_dr1` | none | yes | done | |
| DESI DR2 | 3-year sample | — | — | — | not public | — | — | P2 (blocked) | data.desi.lbl.gov/doc/releases lists only EDR and DR1 (checked 2026-11-13). Re-check in early 2027 |
| DESIVAST voids (DESI DR1 VAC v1.0) | Void spheres in BGS, z < 0.24 | VoidFinder maximal spheres 3,241 + 524 = 3,765 | 4.5 MB of files; spheres ≈ 154 KB | CC BY 4.0 | https://data.desi.lbl.gov/public/dr1/vac/dr1/desivast/v1.0/ | none | yes | P1 | Same method as the SDSS DR7 voids |
| DESI DR1 BGS groups VAC v1.0 | Halo mass, central/satellite flags | 2,229,741 rows | 289,877,760 B | CC BY 4.0 | `…/vac/dr1/bgs-groups/v1.0/` | none | yes | P1 | Attribute join on TARGETID, no new points |
| **SDSS DR17 optical spectra** | Northern 3D coverage outside DESI DR1; QSOs to z ≈ 7 | `zWarning=0`: 2,639,535 GALAXY + 753,228 QSO = **3,392,763** (counted) | 139 MB raw. After de-duplication against DESI, ≈ **2.1 M ≈ 87 MB** (rough: 1,273,779 SDSS–DESI matches within 1.5″ is an upper bound) | "considered in the public domain" (sdss.org/collaboration) | SkyServer SqlSearch https://skyserver.sdss.org/dr17/SkyServerWS/SearchTools/SqlSearch; Data Lab `sdss_dr17.specobj` | SkyServer `*`; Data Lab none | yes | **P0** | De-duplication is the work |
| SDSS DR19 (2025-07-10) | First SDSS-V BHM release | `spAll` good: 81,682 QSO + 22,724 GALAXY | 4.3 MB | public domain | SkyServer `/dr19/` | `*` | yes | superseded | |
| SDSS DR20 (2026-07-30, arXiv:2607.26149) | Largest SDSS-V BHM QSO set, incl. southern LCO | `spAll` `specprimary=1 AND zwarning=0`: **315,760 QSO + 118,272 GALAXY** (counted) | 17.8 MB | public domain | SkyServer `/dr20/` (`spAll`) | `*` | yes | P1 | Not on Data Lab. De-duplicate against DR17 and DESI. No DR21 announced |
| **6dFGS DR3** (final) | Southern nearby redshifts, \|b\| > 10° | 124,647 rows (VII/259); q_cz 3–4: 115,042 | **5.1 MB** | None stated (6dfgs.net, last updated 2014) | VizieR VII/259 (Harvard/IDIA) | VizieR mirror `*` | yes (cz) | **P0** | Overlaps 2MRS |
| **2dFGRS** final (2003-06-30) | Two deep strips, z ≲ 0.3 | 245,591; good z excluding stars: 221,507 (counted) | **9.1 MB** | None found | VizieR VII/250 | `*` | yes | **P0** | Overlaps SDSS/DESI |
| GAMA DR4 ("fourth and final") | Very complete deep patches | 253,144 reliable redshifts | 10.4 MB | None stated; cite Driver+2022 | gama-survey.org/dr4 | none | yes | P1 | Small area. File path not located (unverified) |
| **CF4 density + velocity grids** (Courtois+2023) | Local density contrast + 3D flow field: streamlines, Laniakea context | 64³ float32, supergalactic axes; velocity 64³×3 ("multiply by 52 the velocity values") | delta 1,054,080 B; velocity 3,150,720 B | None: "If you use this data cite the article above" | https://projets.ip2i.in2p3.fr//cosmicflows/CF4_new_64-z008_delta.fits (+ siblings) | none | **yes** (grid) | **P0** | Tiny. **No WCS in the headers; the 64³ box size is unverified** (siblings imply 1000 Mpc/h) |
| **CF4++ HMC mean/std grids** (Courtois+2025, updated 2026-10-13) | Higher-resolution density/velocity with uncertainty | 128³, L = 1000 Mpc/h (from the provider script) → 7.8 Mpc/h voxels | `new_CF4pp_mean_std_grids.npz` 167,773,886 B | None: cite the article | same IP2I directory | none | **yes** | **P0** | **Erratum:** `vr_data` was wrong before 2026-10-13, so use only the current file. Quantise to a 3D texture |
| **CF4 watersheds / Laniakea basins** (Dupuy & Courtois 2023) | Basin labels: Laniakea, Apus, Hercules… | 128³ integer labels over 1000 Mpc/h | zip 67,127,665 B | None: cite the article | same IP2I directory | none | **yes** | **P0** | Extract basin meshes offline |
| CF4 groups (Tully+2023) | Group distances | 38,053 rows (VizieR J/ApJ/944/94) | 1.56 MB | None stated | VizieR; EDD `kcf4allgroup` | VizieR `*`; EDD none | yes | P1 | EDD TLS chain fails verification |
| 2MRS groups (Tully 2015) | Group "nests" | 25,474 nests | 1.0 MB | None stated | VizieR J/AJ/149/171 | `*` | yes | P1 | |
| GLADE+ (VII/291, 2022-10-31) | GW-host galaxy compilation | 23,181,758 | 950 MB; txt 6 GB | None; "© Copyright Gergely Dálya" | VizieR; elysium.elte.hu (timed out) | VizieR `*` | partly (mostly photo-z D_L) | P2 | Ingest its parent catalogues instead |
| Milliquas v8 "Final Edition" (page updated 2026-10-29) | All-sky QSO/AGN | 1,021,800; 1,012,614 with z | 41.9 MB | None stated | VizieR VII/294; quasars.org (HTTP 406 to curl) | VizieR `*` | yes, mixed (photo-z rounded to 0.1) | P1 | Use spec-z rows only, or show photo-z rows smeared |
| Abell/ACO (VII/110A) | Classic rich clusters (labels) | 5,250 | 215 KB | None stated | VizieR | `*` | **no z** | P1 | Needs a z cross-match |
| MCXC (2011) | X-ray clusters | 1,743 | 71 KB | None stated | VizieR J/A+A/534/A109 | `*` | yes | P1 | Superseded |
| **MCXC-II** (Sadibekova+2024) | Updated X-ray clusters, all-sky | **2,221** | 91 KB | None stated | VizieR J/A+A/688/A187 | `*` | yes | **P0** | |
| **eRASS1 clusters** (Bulbul+2024; eROSITA-DE DR1) | Largest X-ray cluster sample (Galactic l > 180°) | **12,247** primary, z 0.003–1.32; 1,338 superclusters | 502 KB; tgz 23,764,095 B | No licence named: "Please acknowledge our work if you use eROSITA-DE DR1 data" | https://erosita.mpe.mpg.de/dr1/AllSkySurveyData_dr1/Catalogues_dr1/BulbulE_DR1/; VizieR J/A+A/685/A106 | eROSITA none; VizieR `*` | yes (mostly photo-z) | **P0** | Half-sky. eROSITA-DE DR2 (2026-07-31) is catalogue-only; no DR2 cluster catalogue found (unverified) |
| Planck PSZ2 | SZ clusters | 1,653; 1,094 with z | 45 KB | None stated; PLA returned 503 | VizieR J/A+A/594/A27; IRSA | VizieR `*`; IRSA none | yes (subset) | P1 | |
| ACT DR5 SZ clusters (Hilton+2021) | High-z clusters | 4,195 | 172 KB | None stated | VizieR J/ApJS/253/3; LAMBDA | VizieR `*` | yes | P1 | |
| SPT clusters (SPT-SZ, ECS, 100d) | Southern SZ clusters | 539 + 448 + 79 | 44 KB | None stated | pole.uchicago.edu/public/data/sptsz-clusters/ | none | yes | P2 | |
| redMaPPer SDSS DR8 | Optical clusters | 26,111 | 1.07 MB | None stated | VizieR J/ApJS/224/1 | `*` | yes (photo-z) | P1 | |
| MSCC/SSCC superclusters (Chow-Martinez+2014) | Named superclusters, z ≤ 0.15 | 601 + 423 | 25 KB | None stated | VizieR J/MNRAS/445/4073 | `*` | yes | P1 | Labels |
| Liivamägi/Einasto superclusters (2012) | Density-field superclusters (SDSS DR7) | 982 (main) | ≤ 150 KB | None stated | VizieR J/A+A/539/A80 | `*` | yes | P1 | |
| SDSS DR7 voids, VoidFinder + V² (Douglass+2023) | Local voids, z < 0.114 | 2,347 maximal spheres (2 cosmologies × 2 prunings) | ≈ 96 KB | None stated | VizieR J/ApJS/265/7 | `*` | yes | P1 | |
| Tempel+2014 SDSS filaments | Cosmic-web filament spines | 15,421 filaments; 275,599 spine points | 11.3 MB | None stated | VizieR J/MNRAS/438/3465 | `*` | yes | P1 | Polylines; strong visual |
| ALFALFA α.100 | HI-selected galaxies with flow distances | 31,502 | 1.29 MB | None stated (cite papers) | egg.astro.cornell.edu/alfalfa/data/a100files/…csv; VizieR J/ApJ/861/49 | Cornell none; VizieR `*` | yes | P1 | |
| WALLABY PDR1/PDR2 (2022, 2024) | Southern HI galaxies | ~600 / ~1,800 | 74 KB | Data policy PDF not read (unverified) | CASDA TAP; CANFAR | none | yes | P2 | Full survey not public |
| 2MPZ (Bilicki+2014) | All-sky photo-z behind 2MRS | "almost 1 million", σz 0.015 | ≈ 41 MB | None; cite + acknowledge WFAU | ssa.roe.ac.uk (bulk link not found) | none | photo-z | P1 | Show as a fuzzy layer |
| WISE×SCOS photo-z | All-sky to z ≈ 0.4 | ≈ 18.5 M | ≈ 759 MB; csv.gz 1,709,149,603 B | as 2MPZ | ssa.roe.ac.uk/cats/… | none | photo-z (~15 %) | P2 | Density layer only |
| Legacy Surveys DR10 photo-z | Deep photo-z | 2,827,055,986 rows | **115.9 GB** as points | None on the page; acknowledgement page | Data Lab `ls_dr10.photo_z` | none | photo-z | P2 | Only as server-side HEALPix × z-shell aggregates |
| **Euclid DR1 "DR1-Foundation" (released 2026-11-12)** | Deep wide imaging, photo-z, NISP spectra | 1,900 deg²; > 900 M galaxies; NISP spectra for > 160 M sources | ≥ 36.9 GB as points | "Euclid DR1 data is licensed with the CC BY-NC 3.0 IGO licence" | euclid.dataspace.esa.int; IRSA | not tested | spec-z subset (quality unverified) | P1 (spec-z) / P2 | Released two days ago. Evaluate the spec-z subset |
| NED-D 17.1.2 (2020) | Redshift-independent distances | 272,573 distances for 147,363 galaxies | 6.0 MB; CSV 41,077,792 B | None; citation request | ned.ipac.caltech.edu/Archive/Distances/… | none | yes | P1 | Tooltip distances for named galaxies |
| HyperLEDA | Homogenised parameters, PGC | **unverified** (host timed out; HTTPS refused) | — | "an acknowledgment would be appreciated" | http://atlas.obs-hp.fr/hyperleda/ | none | yes | P2 | http only, so a Pages site cannot call it |
| SDSS MaNGA DR17 | IFU galaxies (highlights) | 10,010 unique | 410 KB | public domain | SkyServer | `*` | yes | P2 | |

## 3. Transients and multi-messenger

| dataset (release/version) | what it adds to the map | rows/objects or resolution | download/tile size | licence (exact) | access method (endpoint) | browser CORS | 3D-capable? | priority | notes |
|---|---|---|---|---|---|---|---|---|---|
| **GWOSC cumulative event list (GWTC-1 … GWTC-5.0)** | Gravitational-wave mergers with masses, D_L, z | **391 events**: 1 + 54 (2.1) + 35 (3) + 140 (4.1) + 161 (5.0). **282 with D_L/z** | 738,435 B JSON | "Data released under a CC BY 4.0 License" (GWOSC GWTC-5.0 page) | https://gwosc.org/eventapi/json/GWTC/; API v2 `/api/v2/catalogs/{name}/events` | `*` (re-checked 2026-11-14) | yes (D_L 40–8,280 Mpc), but **no RA/Dec in the JSON** | **P0** | GWTC-5.0 (O4b) was released 2026-05-26. GWTC-4.0 has 129 events; the cumulative list uses the 4.1 re-analysis |
| **GWTC 3D skymaps** (Zenodo) | Per-event 3D localisation volumes | Multi-order HEALPix (NUNIQ, MOCORDER 9) with PROBDENSITY, DISTMU, DISTSIGMA, DISTNORM | GWTC-2.1 87.4 MB (rec 6513631); GWTC-3 71.6 MB (8177023); GWTC-4.0 270.4 MB (17602505); GWTC-5.0 268.7 MB (20348005). **≈ 698 MB raw** | cc-by-4.0 (Zenodo metadata) | Zenodo API `https://zenodo.org/api/records/{id}` | `*` | **yes** | **P0** (offline bake) | Bake each event to a 90 % volume point cloud: 282 × 2,000 pts × 3 × 2 B ≈ **3.4 MB**. Do not download the hdf5 PE samples (55 GB) |
| GraceDB O4 public alerts | Retracted and low-significance candidates | 254 significant (283 − 29 retracted); 5,136 low-significance. **None since O4 ended (last S251118cm)** | ≈ 198 MB of skymaps (254 × 0.78 MB) | **unverified** (user guide behind a bot wall) | https://gracedb.ligo.org/api/superevents/ | none | yes | P1 | Snapshot at build time. The significant events are now in GWTC-4.1/5.0 |
| CHIME/FRB Catalog 1 (210806.vFINAL) | FRB positions | 536 bursts | 221,007 B | None stated; cite arXiv:2106.04352 | assets.chime-frb.ca/catalogs/catalog1/… | none | no (DM only) | P2 | Included in Catalog 2 |
| **CHIME/FRB Catalog 2** (release 20251231, published 2026-01-14) | FRB sky shell | 4,539 bursts from 3,641 sources (83 repeaters) | CSV 4,057,396 B | None stated; cite arXiv:2601.09399 (DOI 10.11570/25.0066) | https://assets.chime-frb.ca/catalogs/catalog2/releases/20251231/data/chimefrbcat2.csv | none | no (DM-excess pseudo-distance only, model-dependent) | P1 | 2D layer |
| **FRB host galaxies** (FRBs/FRB `public_hosts.csv`) | Localised FRBs with real redshifts | 103 rows, 101 with z (0.0008–1.016) | 11,065 B | **BSD-3-Clause** (repo) | https://raw.githubusercontent.com/FRBs/FRB/main/frb/data/Galaxies/public_hosts.csv | `*` | **yes** | **P0** | Last commit 2026-10-22. Add the CHIME Outriggers KKO hosts (19 spec-z, arXiv:2502.11217) as P1 |
| Fermi GBM bursts (HEASARC `fermigbrst`) | GRB sky positions | 4,420; live (last trigger 2026-11-11) | small | No licence stated (unverified) | HEASARC TAP https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync | none | no | P2 | Error circles of several degrees |
| Swift GRB table (`swiftgrbba`) | Well-localised GRBs | 2,046 to GRB 261017A; **462 with z** | small | No licence stated (unverified) | HEASARC TAP | none | yes (462) | P1 | Do not use `swiftgrb` (stale since 2012) |
| Greiner GRB table (MPE) | Redshift cross-check | newest GRB 260731B; total not counted | ~180 kB HTML | "an acknowledgement is appreciated" | https://www.mpe.mpg.de/~jcg/grbgen.html | none | partly | P1 (validation) | HTML only |
| TNS | Every named transient | "207,692 PUBLIC transients"; "20,326 PUBLIC classified SNe" | daily CSV (size unverified; curl 403) | **No licence stated** (only "Copyright © 2015") | API needs a registered bot `tns_marker` UA | none | partly | P1 | Email TNS about redistribution first |
| Open Supernova Catalog | Historical SNe | `api.astrocats.space` returns **410 Gone**; GitHub repo MIT, frozen 2023-03-10 | — | MIT (repo) | GitHub astrocatalogs/supernovae | `*` | partly | P2 | **sne.space is now run by an unrelated operator** ("not affiliated with … any prior catalog"). Its pages embed AI-agent tool forms. Treated as untrusted and not used |
| **ZTF Bright Transient Survey** | Clean bright SNe with z | 11,580 confirmed. Explorer CSV 10,988 rows, **10,940 with z**; 7,636 SN Ia; 66 TDEs | 1,341,719 B | **No licence stated**; cite Fremling 2020, Perley 2020, Rehemtulla 2024 | https://sites.astro.caltech.edu/ztf/bts/explorer.php?f=s&format=csv | none | **yes** | **P0** (after asking D. Perley) | |
| **IceCat-1** (v4, 2023-11-09) | Neutrino alert tracks | 348 tracks (IC110514A–IC231014A) | 66,698 B | **CC0 1.0** | https://dataverse.harvard.edu/api/access/datafile/7502710 | `*` | no (direction + error box) | **P0** | Arrows; link to TXS 0506+056 and NGC 1068 |
| IceCube 10-yr point-source events | Neutrino background sky | 1,134,450 | large | unverified | HEASARC TAP `icecubepsc` | none | no | P2 | |
| GCN circulars | Live alert text | archive JSON 31,808,411 B | 31.8 MB | unverified | Kafka (account); gcn.nasa.gov/circulars/{n}.json | none | — | P2 | |
| Rubin/LSST alerts via brokers | Live optical transients | public stream since 2026-02-25; 7 full-stream brokers | — | per broker, unverified | Fink-LSST https://api.lsst.fink-portal.org/; ALeRCE; Lasair | Fink-LSST `*`; ALeRCE echoes origin; Lasair none | some | P2 | Later "live sky" layer |
| McGill magnetar catalogue (2020-11-17) | Galactic magnetars | 30 | tiny | "free to use … please cite" Olausen & Kaspi 2014 | physics.mcgill.ca/~pulsar/magnetar/ | none | yes (kpc) | P1 | |
| TDEs (OTTER, arXiv:2509.05405) | TDE layer | ~240 (search snippet only) | unverified | unverified | unverified | — | some | P2 | BTS already has 66 |
| **Showcase cards: GW170817 / AT2017gfo / NGC 4993; TXS 0506+056; NGC 1068** | Multi-messenger stories | GW170817: 2017-08-17 12:41:04.4 UTC; D_L(GW) 40 +7/−15 Mpc. NGC 4993: SBF **40.7 ± 1.4 ± 1.9 Mpc** (Cantiello+2018; from a search snippet, ADS not opened). TXS 0506+056: z = 0.3365 → Planck18 D_C 1,369 Mpc. NGC 1068: z = 0.00348 | — | — | GWOSC; SIMBAD (Harvard) | — | yes | **P0** (cards) | Use SBF, not the redshift distance, for NGC 4993. NGC 1068 needs a NED-D distance (not fetched) |

## 4. Solar System and near Earth

| dataset (release/version) | what it adds to the map | rows/objects or resolution | download/tile size | licence (exact) | access method (endpoint) | browser CORS | 3D-capable? | priority | notes |
|---|---|---|---|---|---|---|---|---|---|
| **astronomy-engine 2.1.19** (npm, 2023-12-14) | Live Sun, Moon, planets, Pluto | 8 planets + Moon + Pluto | 1.84 MB unpacked | MIT | npm `astronomy-engine` | n/a (bundled) | yes | **P0** | **Not fitted to a JPL DE:** truncated VSOP87, accuracy "±1 arcminute" (≈ 43,500 km at 1 AU), tested against NOVAS/DE405 and Horizons. docs/content-contract.md calls it "JPL-derived"; that should be corrected |
| JPL DE440 / DE441 / DE442 | Reference ephemeris | DE440/442: 1549–2650; DE441: −13200 to +17191 | de440 119.8 MB; de440s 32.7 MB; de441 2 × 1.65 GB | No licence on eph_export (unverified) | naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/ | none | yes | P2 | Only if 1′ is not enough. Precompute at build |
| **JPL Horizons API** | Spacecraft vectors (Voyager 1/2, Pioneers, New Horizons) | ≤ 10,000 epochs per query | small JSON | No licence, rate or CORS statement | https://ssd.jpl.nasa.gov/api/horizons.api | **none** | yes | **P0** (build-time snapshot) | The browser cannot call it |
| MPC MPCORB.DAT (daily) | All asteroid orbits | **1,580,451** records counted 2026-11-14 (895,910 numbered + 684,541 unnumbered; 1,578,595 at the standard epoch K2669 = 2026-06-09 TT) | 320,833,904 B; gz 94,248,709 B (file time 2026-11-13 13:48 UTC) | **Terms are in the file header** (checked 2026-11-14): "Software programs may include this datafile amongst their datasets, as long as this header is included (it is acceptable if it is contained in a file separate from the actual data) and that proper attribution to the Minor Planet Center is given … Information on how to obtain updated copies of the datafile must also be included." The MPCORB web page itself states no terms. The older CBAT catalogue policy ("may not be redistributed") names other products, not MPCORB | https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz | `*` | yes | **built** | `scripts/build_small_bodies.py` re-packs it (data/tiles/small-bodies/, 45.97 MB of orbits + 10.94 MB designations + 1.03 MB names) and ships the header verbatim as `MPCORB_HEADER.txt` with credit and the download URL |
| MPC comets / Distant.txt | Comets; TNOs/Centaurs | AllCometEls 4,666 lines (counted 2026-11-14); Distant 9,374, all of them inside MPCORB (9,356 classed Centaur/TNO by our a/q limits) | 789,178 B; 1,902,922 B | as MPCORB (AllCometEls has no header of its own) | `…/iau/MPCORB/AllCometEls.txt`, `Distant.txt` | `*` | yes | **built** | Comets in `small-bodies/comet.bin` (ellipse, parabola, hyperbola) |
| **JPL SBDB Query API** | Same population via JPL | asteroids 1,580,494; comets 4,088; TNO 8,340 (live counts) | paged JSON | No licence stated (unverified) | https://ssd-api.jpl.nasa.gov/sbdb_query.api | none | yes | P1 (build time) | **All of them can render as points.** 6 × f32 elements = 37.9 MB; quantised 16 B/object = **25.3 MB**. Kepler solve on the GPU (Δt computed in double on the CPU). A cleaner licence path than MPC |
| CelesTrak GP (OMM JSON, GROUP=active, stations, starlink) | Earth satellites | 16,896 objects (11,191 Starlink, 18 station modules) on 2026-11-14 06:40 UTC | 7,114,929 B (active) | No licence text found. Usage policy (updated 2026-11-12): "only download data once per update" (GP: every 2 hours), enforced for the Active and Starlink lists; stop on any non-200 | https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json | `*` (re-checked 2026-11-14) | yes (SGP4) | **built** | `scripts/build_satellites.py` snapshot (gp.json 2.51 MB) + JWST from Horizons. A browser could fetch it (CORS `*`) but per-viewer fetches break the policy, so the viewer reads the snapshot; rebuild at most every 2 h |
| Space-Track | Same GP data | — | — | "not to transfer any data … without prior express approval"; basic SSA has "blanket approval … conditioned on appropriate citation" | account | not tested | yes | P2 | |
| **NASA GIBS BlueMarble_NextGeneration** | Earth globe base | z0–8 (~500 m) | 14.6 kB tile | No licence; GIBS acknowledgement requested; NASA media "generally are not subject to copyright in the United States" | https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg | `*` | n/a | **P0** | |
| GIBS VIIRS NOAA-20 true colour (daily) | Today's Earth | z0–9 (~250 m), 2022-01-14 → today | 22 kB tile | as GIBS | `…/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/…` | `*` | n/a | P1 | **Returns 404 when a Range header is sent**; plain GET works |
| **NASA Trek WMTS: Moon LRO WAC 303 ppd** | Moon surface | ≈ 100 m/px | 49 kB tile | No Trek terms page found (unverified); NASA media rules | https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg | `*` (re-checked 2026-11-14) | n/a | **P0** | Equirectangular; level 0 is 2 × 1 tiles |
| Trek: Moon LOLA colour shade 256 ppd; Kaguya TC 4096 ppd (~7.4 m) | Moon relief / detail | 9 / 13 levels | 159 kB / 68 kB | NASA / JAXA (Kaguya terms unverified) | trek.nasa.gov/tiles/Moon/EQ/… | `*` | n/a | P1 | |
| **Trek: Mars MOLA colour shade 463 m; Viking MDIM21 colour 232 m** | Mars surface | 463 m; 232 m | 63 kB; 53 kB | NASA | trek.nasa.gov/tiles/Mars/EQ/… | `*` | n/a | **P0** | |
| Mars CTX global mosaic beta01 (Murray Lab) | Mars at ~5 m/px | 18 LODs, 512 px | 142 kB tile | "The Murray Lab/Caltech grants free use of the beta01 version of the mosaic for all purposes. Data credit should be to: NASA/JPL/MSSS/The Murray Lab." (quoted from the HiPS properties; the lab page failed TLS) | https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x} (via Trek) | `*` (Esri) | n/a | P1 | Esri host terms unverified. V01 (Dickson+2024) supersedes beta01 |
| Trek: Mercury MDIS 665 m; Vesta HAMO 74 ppd; Ceres FC 59 ppd | Mercury, Vesta, Ceres | as named | 54–126 kB | NASA (+ DLR) | trek.nasa.gov/tiles/{Body}/EQ/… | `*` | n/a | P1 | Titan mosaics also listed (not tested) |
| **Planetary HiPS on the PADC mirror** (Mars CTX/MOLA, Moon LROC-WAC, Mercury, Earth; Venus Magellan, Jupiter, Galilean moons, Titan, Pluto, Charon, Uranian moons) | Spherical tiles for ~30 bodies; the **only** tiled source for outer moons | CTX order 11 ≈ 3.3 m/px; MOLA o5 ≈ 212 m; LROC-WAC o6 ≈ 54 m | CTX Npix0 39.8 kB; MOLA DEM FITS tile 527 kB | Per HiPS: CTX as above; MOLA DEM "Public domain, Please cite authors"; Europa/Io "Public domain"; many say "None" | https://padc-web.obspm.fr/planeto/hips/CDS_P_<Body>_<id>/Norder{n}/Dir{d}/Npix{p}.jpg | `*` (6 tested) | n/a | **P0** (outer moons, Venus) / P1 | The alasky masters are down |
| China-VO Chang'e-2 Moon 7 m DOM HiPS | High-res Moon | order 9 ≈ 6.8 m/px | ≈ 1.45 TB total | obs_copyright not set (unverified) | https://hips.china-vo.org/change2-moon-7m-dom/ | `*` | n/a | P1 | |
| USGS Astrogeology global mosaics (ASC S3) | Mars MOLA DEM 463 m; Moon LOLA LDEM 118 m (to build terrain) | — | 2.13 GB; 8.49 GB | "USGS-authored or produced data … considered to be in the U.S. Public Domain" | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/<file>.tif | `*` | n/a | P1 (build terrain-RGB) | `planetarymaps.usgs.gov` redirects (302) **without ACAO**, so use the S3 URL. COG status untested |
| MOLA MEGDR / LOLA LDEM (PDS) | Raw DEMs | MEGDR 128 ppd 2.08 GB; LDEM_512 ≈ 34 GB | — | PDS public (no text checked) | pds-geosciences.wustl.edu | none | n/a | P2 | |
| **AWS Terrain Tiles (terrarium)** | Earth elevation for the browser | z0–15 | 86–113 kB tile | Cite "registry.opendata.aws/terrain-tiles" plus the tilezen/joerd attribution list (SRTM/3DEP/GMTED USGS, ETOPO1 NOAA, EU-DEM, LINZ CC BY, …) | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png | `*` | n/a | **P0** | Measured 68 kB/s for one 106 kB tile from Tashkent (latency-bound, us-east-1) |
| Copernicus DEM GLO-30/90 (AWS) | Better Earth DEM | 1° COG tiles | N41E069: 41.5 MB / 5.1 MB | "free license"; "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 … all rights reserved" notice | copernicus-dem-30m.s3.amazonaws.com/… | **none** | n/a | P2 | Must be re-tiled and re-hosted |
| EOX Sentinel-2 cloudless 2024 | ~10 m Earth imagery | z14 confirmed | 17 kB tile | "Creative Commons Attribution-NonCommercial-ShareAlike 4.0"; attribution "EOxCloudless … (Contains modified Copernicus Sentinel data <year>)" | https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg | echoes origin | n/a | P1 | NC-SA fits our non-commercial status. The 2016 layer returned 404 |
| OpenStreetMap tiles | Street map | z0–19 | 6.7 kB | "Bulk download ('scrape') … prohibited"; attribution required | tile.openstreetmap.org | `*` | n/a | P2 | Heavy use forbidden |
| **Solar System Scope textures** | Low-res fallback for every body | 2k/8k per body | Earth 8k 4.57 MB; Mars 2k 0.75 MB | "Attribution 4.0 International … for any purpose, even commercially" | solarsystemscope.com/textures/download/… | **none** | n/a | **P0** (re-host) | Ceres, Haumea, Makemake and Eris maps are **"fictional"**; do not use them |

### Planetary surfaces in use (web/src/solar/surface, checked 2026-11-14)

Every endpoint below was fetched with `curl -H 'Origin: https://example.org'` on 2026-11-14 and
answered `Access-Control-Allow-Origin: *`. Tile matrices are from each WMTS capabilities document
(Trek) or the MapServer JSON (CTX): all are geographic, origin (−180°, +90°), level 0 = 2 × 1 tiles
of 180°, rows from the north. Trek tiles are 256 px, CTX tiles 512 px over the same geometry.

| layer | levels used | finest | licence / credit (what was actually found) | notes |
|---|---|---|---|---|
| Moon LRO WAC global mosaic v2, 303 ppd (`LRO_WAC_Mosaic_Global_303ppd_v02`, jpg) | 0–8 | ~83 m/px at level 8 | LROC is NASA/GSFC/Arizona State University; NASA media are not copyrighted in the US. **No terms page on trek.nasa.gov** (its `textAbout.html` has none) | default Moon imagery |
| Moon LOLA colour-shaded relief v6, 256 ppd (`LRO_LOLA_ClrShade_Global_256ppd_v06`, png) | 0–6 | ~118 m/px | NASA/GSFC (LOLA); same Trek caveat | "Show relief" button |
| Mars Viking MDIM 2.1 colour mosaic, 232 m (`Mars_Viking_MDIM21_ClrMosaic_global_232m`, jpg) | 0–7 | ~325 m/px at level 7 | NASA/JPL/USGS; same Trek caveat | colour of Mars at every level |
| Mars MOLA colour-shaded relief, 463 m (`Mars_MGS_MOLA_ClrShade_merge_global_463m`, jpg) | 0–7 | ~325 m/px | NASA/JPL/GSFC; same Trek caveat | "Show relief" button |
| Mars MRO CTX global mosaic beta01, Murray Lab (Esri cache `astro.arcgis.com/…/OnMars/CTX/MapServer/tile/{z}/{y}/{x}`, greyscale png) | 5–12 | ~5 m/px at level 12 | murray-lab.caltech.edu/CTX (read 2026-11-14; the site's TLS chain is incomplete, fetched with `curl -k`): "The Murray Lab/Caltech grants free use of the V01 version of the mosaic for all purposes. Data credit should be to: NASA/JPL/MSSS/The Murray Lab." The Esri cache serves **beta01**, whose free-use grant is quoted in the HiPS properties above. Esri's own hosting terms: not checked | some tiles answer **HTTP 500 without a CORS header** (e.g. level 11 near Gale, 2026-11-14 11:30; the same tile answered 200 at 11:57). The viewer retries twice, then falls back to the coarser CTX tile |

**Elevation: none.** No DEM tile service with CORS was found for the Moon: Trek lists
`LRO_LOLA_DEM_Global_128ppd_v04` only as a 2.2 GB raw download (search API `TrekServices/ws/index/eq/searchItems`,
`RASTER_TYPE raw`), and `…/LRO_LOLA_DEM_Global_256ppd_v06/1.0.0/WMTSCapabilities.xml` is a 404; the PADC
HiPS mirror has only a colour hillshade for the Moon. For Mars, the only browser-reachable DEM is the PADC
HiPS `CDS_P_Mars_MGS-MOLA-DEM` (FITS, 16-bit, order 4 × 512 px, CORS `*`, "Public domain, Please cite
authors"): a HEALPix pyramid, not wired up. The surface is therefore a sphere with flat imagery.

**Names:** IAU/USGS Gazetteer of Planetary Nomenclature centre-point shapefiles
(`asc-planetarynames-data.s3.us-west-2.amazonaws.com/{MOON,MARS}_nomenclature_center_pts.zip`,
Last-Modified 2026-11-13; USGS public domain), Wikidata ru/uz labels via P2824 (CC0), Apollo LM
positions from NSSDCA. Built by `scripts/build_planet_features.py`.

## 5. Sky imagery and backgrounds

The notes column opens with **Embeddable** (in a public non-commercial site): yes / with credit / no.

| dataset (release/version) | what it adds to the map | rows/objects or resolution | download/tile size | licence (exact) | access method (endpoint) | browser CORS | 3D-capable? | priority | notes |
|---|---|---|---|---|---|---|---|---|---|
| **DSS2 colour (CDS/P/DSS2/color)** | Full-sky optical background | order 9, 512 px → 0.805″ | hips_estsize ≈ 281 GB; Npix0 31.8 kB | STScI: "not in the public domain"; "Creative Commons Attribution-NonCommercial-ShareAlike license (CC BY-NC-SA 4.0)"; "freely for all scientific, educational, and non-profit purposes" | https://skies.esac.esa.int/DSSColor/ (also CASDA, China-VO, MAST S3) | `*` on all 4 mirrors (re-checked 2026-11-14) | no | **P0** | **Embeddable: with credit, NC-SA.** The old DSS restriction is now CC BY-NC-SA 4.0 |
| **Gaia DR3 RGB (ESAVO/P/GAIA/DR3-RGB)** | Colour Milky Way from Gaia | order 7 → 3.22″ | Npix0 722 kB | "Gaia data are distributed under the CC BY-NC 3.0 IGO license"; hips_copyright Sandro Moreira, André Moitinho | https://skies.esac.esa.int/Gaia/dr3/RGB/ | `*` | no | **P0** | **Embeddable: with credit (NC).** Complements our own Gaia flux sky image |
| 2MASS colour | Near-IR sky | order 9 → 0.805″ | ≈ 75 GB | obs_copyright "University of Massachusetts & IPAC/Caltech"; IPAC FAQ says gallery images are public domain, acknowledgement requested | https://skies.esac.esa.int/2MASSColor/ | `*` | no | P1 | Embeddable: with credit |
| AllWISE colour | Mid-IR sky | order 8 → 1.61″ | ≈ 18.8 GB | obs_copyright "IPAC/NASA" (formal licence unverified) | https://skies.esac.esa.int/AllWISEColor/ | `*` | no | P1 | Embeddable: with credit (likely) |
| **Planck PR3 CMB maps (IRSA)** | Our own CMB HiPS for the z ≈ 1100 shell | Nside 2048 (50,331,648 px) | SMICA IQU 2,013,312,960 B; **smica-nosz 402,661,440 B**; Commander 1.61 GB | ESA data-use page asks for an acknowledgement. CMB image: "CC BY-SA 3.0 IGO or ESA Standard Licence" | https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/maps/component-maps/cmb/ | none (build input) | **no** (a shell at fixed comoving distance) | **P0** (build) | Embeddable: with credit. An order-3 HiPS (768 tiles) is small |
| CDS/P/PLANCK/R3/CMB (ready HiPS) | Same, prebuilt | order 3, 256 px → 1.72′ | 363 MB | obs_copyright "EUROPEAN SPACE AGENCY. ALL RIGHTS RESERVED" | alasky only, **404 now** | `*` but 404 | no | P1 (blocked) | Same for the R2, ACT-Planck and ACT DR4 CMB HiPS |
| Planck PR4 (NPIPE) | Newer CMB maps | unverified | unverified | as Planck | PLA returned **503**; NERSC has frequency maps only | — | no | P2 | |
| eROSITA eRASS1 RGB | X-ray sky (western Galactic half) | order 6 → 6.44″; sky fraction 0.505 | ≈ 5.4 GB | No licence; acknowledgement text required | https://erosita.mpe.mpg.de/erodat/static/hips/eRASS1_RGB_Rate_c010/ | `*` | no | P1 | Embeddable: with credit (formal licence unverified) |
| DESI Legacy Surveys DR10/DR11 colour | Deep extragalactic sky | order 11 → 0.201″ | not listed | "Images are licensed under a Creative Commons Attribution 4.0 International License" | alasky only, **404 now** | 404 | no | P1 (blocked) | Embeddable: with credit. Possible alternative: the Legacy Survey viewer's own tile service (not tested) |
| Pan-STARRS DR1 colour | Deep optical, dec > −30° | order 11 → 0.201″ | CDS says ≈ 1.2 TB (MAST properties disagree) | obs_copyright "PS1 Science Consortium"; acknowledgement only (unverified) | https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/PanSTARRS/ | `*` | no | P1 | Embeddable: probably, with credit |
| SDSS9 colour | Optical, 36 % of sky | order 10 → 0.403″ | ≈ 54 GB | "We provide all images on a Creative Commons Attribution license (CC-BY)" | https://skies.esac.esa.int/SDSS9Color/ | `*` | no | P2 | Embeddable: with credit. Superseded |
| Planck HFI colour (353/545/857 GHz dust) | Dust sky | order 3, 128 px | not listed | "EUROPEAN SPACE AGENCY. ALL RIGHTS RESERVED" | alasky only (down); ESAVO HFI single bands listed (not tested) | 404 | no | P2 | Embeddable: with credit |
| Gaia DR3 density (CDS/P/DM/I/355/gaiadr3) | Star-density map | order 7 | 287 GB | "ESA/Gaia mission/DPAC" | alasky only (down) | 404 | no | P2 | We already have our own |
| Mellinger colour | Pretty optical Milky Way | order 4 | 36.7 MB | "Copyright 2000-2017 Axel Mellinger. All rights reserved"; educational use "will require payment of a license fee" | alasky only (down) | 404 | no | P2 | **Embeddable: no** (needs a licence) |

### Built 2026-11-14 (CMB, sky backgrounds, FRBs, neutrinos)

What the multi-messenger phase actually used, with what was measured while building it:

- **Planck PR3 SMICA** (IRSA, `COM_CMB_IQU-smica_2048_R3.00_full.fits`, 2,013,312,960 B, size
  matched): column `I_STOKES_INP`; residual monopole 0.16 µK and dipole 3.5 µK removed; inpainted
  area 1.5 % of the sky; rms 106.8 µK outside TMASK. Baked by `scripts/build_cmb.py` into a
  4096 × 2048 equirectangular texture (2.9 MB, ±300 µK, Moreland cool-warm). IRSA serves ~0.36 MB/s
  per connection; 16 ranged connections gave ~3 MB/s. PR4 was not used (see the row above).
- **eROSITA eRASS1 RGB HiPS**: order 2 (192 tiles, none missing), ACAO `*` re-checked. No licence is
  named; the DR1 acknowledgement text is reproduced in the credits. Baked to the Gaia image's
  Hammer-Aitoff grid (1.2 MB).
- **Planck HFI 857 GHz HiPS** on the ESA mirror (`skies.esac.esa.int/pla/HFI_SkyMap_857_2048_R3_00_full_HiPS/`,
  galactic, order 3, 256 px PNG, ACAO `*`, hips_copyright "ESA"): this replaces the alasky-only
  "Planck HFI colour" row above for a dust background (0.5 MB).
- **AllWISE colour** (ESA mirror) was baked at orders 2 and 3 and **left out**: Moon-contamination
  streaks, moiré rings and tile-to-tile background jumps over much of the sky at those orders.
- HiPS tile pixel order (calibrated against our Gaia image, `build_sky_backgrounds.py --calibrate`):
  column = odd bits, row = even bits of the in-tile NESTED index.
- **FRB hosts** (`public_hosts.csv` + `FRBs_base.csv`, BSD-3-Clause): 101 hosts with z in 3D.
  **CHIME/FRB Catalog 2**: 5,045 CSV rows = 4,539 bursts (sub-bursts are separate rows), 3,641
  sources, 83 repeaters; 36 sources already in the localised list; 26 sidelobe sources have no
  position and are dropped; 3,579 CHIME + 82 localised-without-z = 3,661 sky directions.
- **IceCat-1** v4 (CC0): 348 tracks, RA/Dec errors are asymmetric 90 % rectangles (README).
  KM3-230213A (RA 94.3°, Dec −7.8°, r90 2.2°, 220 +570/−110 PeV) added from the KM3NeT papers.
- TXS 0506+056: SIMBAD (Harvard) 77.358185, +5.693148 = NED to < 0.001″; z = 0.3365, Planck18
  D_C 1,369.31 Mpc. NGC 1068: SIMBAD 40.669622, −0.013294 vs NED 40.6696, −0.0132865 (0.08″);
  distance 14.4 Mpc as used by IceCube 2022.

## 6. Names and cross-IDs

| dataset (release/version) | what it adds to the map | rows/objects or resolution | download/tile size | licence (exact) | access method (endpoint) | browser CORS | 3D-capable? | priority | notes |
|---|---|---|---|---|---|---|---|---|---|
| **SIMBAD (CfA mirror)** | Cross-IDs, types, redshifts | 22,163,492 objects (counted); data to 2026-10-14 | TAP | "free without any registration under ODbL licence"; cite Wenger+2000 | https://simbad.harvard.edu/simbad/sim-tap/sync | `*` (re-checked 2026-11-14) | partly | **P0** (switch endpoint) | `simbad.cds.unistra.fr` is 404 during the CDS incident. About 6 queries/s (astroquery docs, not an official CDS figure) |
| **Sesame name resolver** | Live "type a name → fly there" | — | XML/JSON | CDS (ODbL for SIMBAD content) | https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?M31 → 302 → vizier.idia.ac.za | `*` on both hops | — | **P0** (live search fallback) | Works today through the redirect |
| NED | Redshifts, distances | — | — | Usage-policy page is 404 (**unverified**); "Copyright © 2026, Caltech" | TAP https://ned.ipac.caltech.edu/tap/sync; ObjectLookup | none | yes | P1 (build time) | |
| IAU WGSN | Star proper names | 653 (our fetch; IAU added 59 on 2026-02-12) | small | "IAU-star names are free to use and not subject to copyright or intellectual property licensing" (exopla.net) | exopla.net HTML table | n/a | yes | done | |
| OpenNGC v20260501 | NGC/IC objects | `NGC.csv` 13,971 lines | 3.94 MB | "released under CC-BY-SA-4.0" (README) | https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv | `*` | partly | done | **ShareAlike:** our derived `messier-ngc.json` must be CC BY-SA 4.0. That should be stated in the README credits |
| HyperLEDA | PGC ids, parameters | unverified | — | acknowledgement requested | http://atlas.obs-hp.fr/hyperleda/ | none (HTTPS refused) | yes | P2 | Build time only |
| **Wikidata** | uz/ru/en labels; uz/ru Wikipedia links for "Batafsil" | galaxies (P31 Q318) alone: 2,094,437 items | SPARQL JSON | "released into the public domain under Creative Commons Zero" | https://query.wikidata.org/sparql | `*` | — | **P0** (build-time harvest) | We hit 429 and 504 (60 s timeout). Never query it per click; bake a label table |

**Wikidata coverage of Uzbek and Russian (measured 2026-11-13/14).** "uz≠en" counts uz labels that
are not just a copy of the English label.

| class | items | uz label | uz≠en | ru label | uz.wikipedia article | ru.wikipedia article |
|---|---|---|---|---|---|---|
| Messier (`M n`) | 110 | 38 | 18 | 98 | 38 | 110 |
| NGC (`NGC n`, strict regex) | 8,310 | 383 | 27 | 487 | **7,377** | 5,920 |
| IC (`IC n`) | 5,009 | 734 | 197 | 569 | **4,731** | 337 |
| Constellations (86 of 88 matched) | 86 | 76 | 74 | 86 | 70 | 86 |
| Planets | 8 | 8 | 6 | 8 | 8 | 8 |
| Moons of Earth → Neptune | 302 | 24 | 17 | 208 | 23 | 222 |
| WGSN stars matched by HIP | 558 | 54 | 43 | 484 | 38 | 395 |
| Galaxies (P31/P279* Q318) | – | timed out | – | timed out | 9,855 | 5,374 |

Reading the numbers:
- **uz labels are thin.** Only constellations, planets, 43 stars and 18 Messier objects have real
  Uzbek names. The rest must be written by the project.
- **uzwiki articles are plentiful for NGC/IC** (bot-generated). Use sitelinks for the "read more
  (uz)" links.
- **ru coverage is good**: Messier 98 of 110, WGSN stars 484 of 558.

Query template (UA `cosmic-atlas-inventory/0.1`, `Accept: application/sparql-results+json`):

```sparql
SELECT (COUNT(DISTINCT ?i) AS ?n) (COUNT(DISTINCT ?u) AS ?uz) (COUNT(DISTINCT ?ux) AS ?uz_not_copy_of_en) (COUNT(DISTINCT ?r) AS ?ru) WHERE {
 { SELECT DISTINCT ?i WHERE { <CLASS> } }
 OPTIONAL { ?i rdfs:label ?le FILTER(lang(?le)="en") }
 OPTIONAL { ?i rdfs:label ?lu FILTER(lang(?lu)="uz") }
 OPTIONAL { ?i rdfs:label ?lr FILTER(lang(?lr)="ru") }
 BIND(IF(BOUND(?lu), ?i, ?unb) AS ?u)
 BIND(IF(BOUND(?lu) && (!BOUND(?le) || STR(?lu) != STR(?le)), ?i, ?unb) AS ?ux)
 BIND(IF(BOUND(?lr), ?i, ?unb) AS ?r) }
```

`<CLASS>` patterns:
- Messier: `?i p:P528 ?s . ?s pq:P972 wd:Q14530 ; ps:P528 ?c . FILTER(REGEX(?c,"^M ?[0-9]+$"))`
- NGC: the same with `wd:Q14534` and `"^NGC ?[0-9]+[A-Za-z]?$"`. Without the regex the pattern
  returns 40,866 items, because cluster members carry codes like "NGC 2516 35".
- IC: `wd:Q741672`, `"^IC ?[0-9]+[A-Za-z]?$"`
- Constellations: `?i wdt:P31 wd:Q8928 ; wdt:P1813 ?sn`, matched against the 88 IAU abbreviations
  (Cancer and Aries are typed "zodiacal constellation").
- Moons: `?i wdt:P397 ?p ; wdt:P31/wdt:P279* wd:Q2537`
- WGSN stars: `VALUES ?code {"HIP …"} ?i wdt:P528 ?code`
- Wikipedia articles: `?a schema:about ?i ; schema:isPartOf <https://uz.wikipedia.org/>`

## 7. Hosting reality

**The constraint.**
- Tiles today: DESI 618.6 MB, plus the Gaia 37 M build at ≈ 1.5 GB (37e6 × 40.86 B). **The Gaia
  build alone already exceeds the 1 GB Pages limit.**
- Full Gaia DR3 ≈ 60 GB / 513k files. Gaia DR4 up to ≈ 82 GB. Target: 50–200 GB and 0.5–1 M files.
- One tour is 1,071 requests / 138 MB (docs/deploy.md).

### Measured from this Mac in Tashkent (2026-11-14)

| host | edge that served us | connect (TCP) | throughput | CORS |
|---|---|---|---|---|
| GitHub Pages (our site) | Fastly `cache-ams` (Amsterdam), ping 106 ms | 0.10 s | **2.28 MB/s** (3.75 MB sky jpg) | `*` |
| Cloudflare (Pages, jsDelivr, any R2 custom domain) | `colo=WAW` (Warsaw), `loc=UZ` | 0.46 s (jsDelivr) | 0.94 MB/s jsDelivr. Our earlier Pages test: 10–65 KB/s | `*` (jsDelivr) |
| **Bunny CDN** (fonts.bunny.net, test zone) | `BunnyCDN-RU1-1116` (Russia), `cdn-requestcountrycode: UZ`, ping **58 ms** | **0.06–0.15 s** | **not measured** (no large public Bunny file found) | `*` (fonts zone) |
| ESA Gaia CDN (CDN77) | `x-77-pop: copenhagenDK`, ping 98 ms | 0.19 s | **3.62 MB/s** (8 MB range) | `*` |
| Hugging Face (Xet CDN, AWS Paris) | 15.236.85.177 | 0.94 s | 2.19 MB/s (8 MB range) | `*` |
| Zenodo (CERN) | 137.138.121.78 | 0.41 s | 0.54 MB/s (8 MB range) | `*` on `/api/…/content` |
| Hetzner Helsinki / Falkenstein | speed-test files | 0.09 / 0.11 s | 1.66 / 1.46 MB/s (single stream) | n/a (our own server would set it) |
| AWS S3 us-east-1 (terrain tile) | — | 0.48 s | 68 kB/s (one 106 kB tile, latency-bound) | `*` |

Caveats:
- Each figure is a single curl measurement from one ISP. They indicate rather than prove.
- **The Bunny figure needs a real throughput test** on a trial pull zone (14-day free trial, no
  card).
- Published PoP lists:
  - Bunny lists **Almaty, Baku, Tbilisi, Yerevan, Istanbul, Moscow** (no Tashkent).
  - CloudFront lists Istanbul, Warsaw and Dubai, but **no Russia/Central Asia** PoP.
  - Cloudflare's status page lists no Central Asian data centre. Whether a Tashkent PoP exists is
    unverified, but the free plan routed us to **Warsaw**.

### Comparison (official pricing pages, read 2026-11-13/14)

Scenario (a) is 100 GB stored + 1 TB/month egress. Scenario (b) is 200 GB + 10 TB/month.

| host | storage price | egress price | free tier | limits (files/size/requests) | CORS | Range | PoPs near Central Asia | ToS fit | est. cost (a) | est. cost (b) | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GitHub Pages, multi-repo split | free | free | 1 GB per site; 100 GB/month soft per site | ≤ 1 GB site, 10 min deploy, 429 on rate limit; files < 100 MiB | `*` (measured) | yes | Fastly AMS (106 ms) | Pages "is intended to host static web pages" and "may not be appropriate for some high-bandwidth uses". Splitting is not forbidden, but it is not a CDN | $0, but ≥ 100 repos/sites | ToS risk: 10 TB is far over 100 GB × N soft limits | Good for the app plus a lite tile set (today's setup) |
| **Bunny Storage + Bunny CDN** (Standard network) | Standard HDD **$0.01/GB** for 1 region (+$0.005 per extra region); Edge SSD $0.02/GB | **EU & NA $0.01/GB; Asia & Oceania $0.03; Middle East & Africa $0.06**, billed by the region that serves. Volume network (10 PoPs) $0.005/GB | 14-day trial; **$1/month minimum** | "No API fees"; free storage → CDN traffic | `*` seen on bunny zones; pull-zone CORS config not checked in docs (unverified) | yes | **RU1 edge served UZ (58 ms)**; Almaty, Baku, Tbilisi, Istanbul listed | Normal paid CDN; no restriction found | $1 + $10–30 = **$11–31** | $2–4 + $100–300 = **$102–304**; Volume network ≈ $52 | Which price region UZ traffic falls into: **unverified**. RU1 is a European PoP, so likely $0.01 |
| Backblaze B2 (direct) | **$6.95/TB-month** (first 10 GB free) | free up to **3× average storage**, then **$0.01/GB**; free unlimited to partner CDNs (Cloudflare, bunny.net, Fastly, …) | 10 GB | Class A/B/C calls free (pay-as-you-go); Class D $0.004/10k | B2 CORS rules (not tested) | yes | US/EU regions only | fine | $0.63 + 700 GB × $0.01 = **≈ $7.6** | $1.39 + 9.4 TB × $0.01 = **≈ $95** | Pair with Bunny (free B2 → Bunny egress) only if storage grows past ~1 TB; at 200 GB, Bunny Storage is cheaper and simpler |
| Cloudflare R2 (custom domain) | **$0.015/GB-month** | **free** | 10 GB-month; 1 M Class A, 10 M Class B per month | Class B $0.36/M after the free 10 M | bucket CORS policy | yes | **Warsaw for UZ** (measured) | fine (r2.dev is dev-only) | $1.35 + 7.8 M GETs (free) = **≈ $1.35** | $2.85 + (77.6 M − 10 M) × $0.36/M = **≈ $27** | Cheapest worldwide. Slow path to Uzbekistan on the free plan (our 10–65 KB/s Pages test; jsDelivr via WAW 0.94 MB/s) |
| AWS Open Data sponsorship (S3 + optional CloudFront) | covered if accepted | Program "covers the cost of storing and sharing"; egress wording not explicit (unverified) | — | criteria: openly licensed, cloud-optimised, community, demand | S3 CORS config | yes | CloudFront: Istanbul, Warsaw, Dubai; none in Central Asia | **Gaia is CC BY-NC**; whether an NC licence passes "openly licensed" is unverified | $0 if accepted | $0 if accepted | Decision "generally within a two-week period". Worth applying in parallel. Plain S3 from UZ is slow (68 kB/s, latency-bound) |
| Zenodo | free | free | 50 GB per record, **max 100 files per record**, one-time raise to 200 GB | "splitting one large dataset into many records to get around the 50 GB limit is not considered fair usage" | `*` on `/api/…/content` | yes | CERN Geneva (0.54 MB/s) | **archive, not a tile host** | n/a | n/a | Use for citable tarball snapshots plus a DOI |
| Hugging Face datasets | free (public) | free | **3,000 `/resolve/` requests per 5 min per IP (anonymous)**; 5,000 for free users (table "September '25", "subject to change") | < 100k files per repo, < 10k per folder | `*` | yes | AWS Paris (2.19 MB/s) | "excessive or irrelevant data" is abuse (README) | $0 | $0 | One tour (1,071 requests) uses a third of a visitor's 5-minute quota. Mirror only |
| Hetzner Cloud VPS (Helsinki) + volume | CPX22 (2 vCPU, 4 GB, 80 GB NVMe) **€16.99/month**, 20 TB traffic included; volumes 10 GB–10 TB (price per GB not read) | **€1.00 per extra TB** (EU) | — | own server | own config | yes | Helsinki/Falkenstein (1.5–1.7 MB/s) | fine | ≈ €17 + volume | ≈ €17 + volume (10 TB is inside 20 TB) | Cheap flat egress; single origin, no CDN. Volume price unverified |
| **VPS in Tashkent: aHOST VDS (TAS-IX)** | 100 GB SSD **320,000 UZS** (≈ $26.7); 200 GB **590,000 UZS** (≈ $49.3); 400 GB 1,040,000 UZS (≈ $86.9) per month (ahost.uz/vds, CBU rate 11,973.44 UZS/USD on 2026-11-13) | unmetered: "UNLIM 100" = **100 Mbit/s** Internet + TAS-IX "БЕСПЛАТНО" (free); faster ports are paid | — | 100 Mbit/s ≈ 12.5 MB/s **shared by all visitors** | own config | yes | **in Tashkent, inside TAS-IX** | fine | **≈ $27** | **≈ $49**; 10 TB/month needs ≈ 31 Mbit/s average, so it fits 100 Mbit/s only off-peak | Best path for Uzbek users (domestic TAS-IX traffic). Poor for the rest of the world. Single server, no redundancy. Speed not measured |
| Oracle Cloud Always Free | storage 10 GB Standard + 10 GB IA object storage (developer page via search; block-volume total unverified) | **"Up to 10 TB per month"** outbound, Always Free | — | — | own config | yes | unverified | fine | $0 if it fits | $0 if it fits | The official free-tier page returned 403 to our fetcher, so figures come from search snippets of oracle.com (**unverified**) |

### Recommendation

1. **Primary tile origin: Bunny Storage (1–2 regions) + Bunny CDN pull zone (Standard network).**
   - It is the only CDN whose edge sat on the short path from Tashkent (RU1, 58 ms), and it also
     lists Almaty, Baku, Tbilisi and Istanbul.
   - It costs about **$11–31/month for 1 TB**, about **$102–304 for 10 TB**, or about $52 on the
     Volume network. There are no request fees, and storage costs $1–4/month.
   - Before committing, run the 14-day trial: upload the 2.1 GB current set, then measure a real
     tour from Uzbekistan and from an EU/US vantage.
2. **App: stay on GitHub Pages** with `TILE_BASE` pointing at Bunny. Keep a **lite tile set on
   Pages** as the zero-account fallback, as today.
3. **Mirrors:**
   - **R2** (≈ $1–27/month, free egress) for the rest of the world if Bunny's Asia pricing bites.
   - **Hugging Face** for a full-data public mirror.
   - **Zenodo** for versioned, citable tarballs.
4. **Apply to the AWS Open Data sponsorship now.** The decision takes about 2 weeks. If accepted,
   use S3 as the origin and put Bunny in front. The open question is whether CC BY-NC (Gaia, Euclid)
   is accepted.
5. **Optional Uzbek edge:** an aHOST TAS-IX VDS (≈ $27–49/month), serving the same tiles to Uzbek
   IPs only. This is a later optimisation once real traffic exists, not a launch requirement.

---

## Recommended build order

Effort is for one developer working with this repo's existing pipeline: rough days of focused work.

### P0: next phase (≈ 6–8 weeks in total)

| step | what | data needed | effort |
|---|---|---|---|
| P0.1 Hosting | Bunny trial; upload the current 2.1 GB; measure; switch `TILE_BASE`; lite set stays on Pages. Apply to AWS Open Data | §7 | 2–3 d |
| P0.2 Endpoint hygiene | Replace every `*.cds.unistra.fr` / alasky URL with mirror lists (IDIA, CfA, ESA skies, PADC). Add a live search fallback through Sesame and SIMBAD-CfA | §6, §5 | 1–2 d |
| P0.3 Milky Way structure pack (small JSON / octree layers) | Hunt & Reffert clusters (+ 1.29 M members as tags or points, 52.8 MB); Baumgardt GCs; galstreams polylines; Radcliffe Wave; Zucker clouds; WISE HII V3.0 (1,435 with distances); Exoplanet Archive hosts; LVDB in place of McConnachie | §1 | 5–7 d |
| P0.4 3D dust volume | Edenhofer 2024 MEAN → uint8 512×512×128 (33.6 MB) 3D texture + ray-marched volume renderer (WebGPU, WebGL2 fallback) | §1 | 7–10 d. **Done 2026-11-14** as 6 pc uint8 418×418×134 + 12 pc RGBA8 (mean, std, A_V from the Sun) = 35.1 MB, from the HEALPix product; see web/README "3D dust" |
| P0.5 Cosmic flows | CF4 64³ delta/velocity + CF4++ 128³ mean/std (post-erratum) + Laniakea watershed meshes; streamlines; reuses the P0.4 volume renderer | §2 | 5–7 d |
| P0.6 More galaxies | SDSS DR17 good-z (≈ 2.1 M after de-duplication against DESI); 6dFGS; 2dFGRS; MCXC-II + eRASS1 cluster markers | §2 | 4–5 d |
| P0.7 Multi-messenger | GWTC-5.0 cumulative list + baked 90 % volumes (≈ 3.4 MB); FRB hosts (101 z); IceCat-1 arrows; ZTF BTS (after the licence email); GW170817 / TXS 0506+056 / NGC 1068 cards | §3 | 5–6 d |
| P0.8 Solar System v1 | astronomy-engine bodies; Solar System Scope textures (re-hosted, CC BY); Horizons spacecraft snapshot (CI job) | §4 | 5–7 d |
| P0.9 Planet surfaces | Tiled globe renderer: GIBS BlueMarble + terrarium elevation for Earth; Trek WMTS for Moon/Mars; PADC HiPS for Venus and outer moons | §4 | 8–12 d |
| P0.10 Sky and CMB | HiPS background from ESA skies (DSS2 colour, Gaia DR3 RGB); our own order-3 CMB HiPS from Planck SMICA R3 for the z ≈ 1100 shell | §5 | 3–4 d |
| P0.11 Names | Wikidata build-time harvest of uz/ru labels + uz/ru wiki links for every named object; the gaps list goes to translators | §6 | 2–3 d |

### P1: after hosting is proven (≈ 6–10 weeks)

- **Full Gaia DR3 1.47 B** from the CDN77 bulk files + GAVO BJ distances. About 60 GB in about 513k
  files, so first move to Potree-2-style consolidated files read by Range (prior-work §5). 2–3 weeks.
- **Gaia DR4** once released (2026-12-02): the layer pipeline as-is for positions. Distances wait
  for GSP-Phot or a BJ-style catalogue. 1 week plus waiting.
- Vergely 50 pc cube as the outer dust shell (when CDS is back); DR3 variables as tags; GCNS
  toggle; ATNF pulsars; Gentile Fusillo WDs; 10 pc sample; Reid masers. 1–2 weeks.
- SDSS DR20 BHM QSOs; DESIVAST and DR7 voids; Tempel filaments; superclusters (MSCC, Liivamägi,
  eRASS1); CF4/2MRS groups; ALFALFA; 2MPZ fuzzy layer; Milliquas spec-z subset; Euclid DR1 spec-z
  evaluation. 2–3 weeks.
- CHIME Catalog 2 sky shell; Swift GRBs with z; GraceDB snapshot; magnetars. 1 week.
- Asteroids (1.58 M from SBDB, 25 MB, GPU Kepler); comets/TNOs; CelesTrak satellites via a 2-hourly
  job; CTX 5 m Mars; Kaguya; Mercury/Vesta/Ceres; USGS DEMs → terrain-RGB; EOX Sentinel-2. 3–4
  weeks.
- 2MASS / AllWISE / eROSITA / Pan-STARRS HiPS options. 2–3 d.

### P2: blocked or low value

- DESI DR2 (not public).
- Photo-z giants (LS DR10 115.9 GB, WISE×SCOS, GLADE+, Euclid photometry): only as server-side
  HEALPix × z-shell density aggregates.
- Planck PR4 (PLA 503).
- WALLABY full survey.
- TNS bulk (licence).
- Rubin broker live layer.
- HyperLEDA.
- Copernicus DEM re-tiling.
- APOGEE / MWM / GALAH / LAMOST attribute joins.
- DE44x precision ephemerides.

### Open items that block or change decisions

1. CDS recovery date (Vergely cubes, alasky-only HiPS: Legacy Surveys, Planck HiPS).
2. Bunny throughput from Uzbekistan and which price region it bills (trial).
3. AWS Open Data and CC BY-NC.
4. Licence emails: ZTF BTS (D. Perley), TNS, Baumgardt (redistribution). MPC is settled: the MPCORB header allows inclusion with the header, credit and the download URL (checked 2026-11-14).
5. Fixes for existing docs:
   - prior-work.md says Gaia DR4 is "Released"; it is scheduled.
   - content-contract.md calls astronomy-engine "JPL-derived"; it is VSOP87-based.
   - OpenNGC-derived JSON must carry CC BY-SA 4.0.
