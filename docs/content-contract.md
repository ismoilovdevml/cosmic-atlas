# Content contract: object kinds, docs, languages (v1)

Shared rules for the Solar System, new catalogues, the in-app docs and the three UI languages.
Data/tile rules stay in [data-contract.md](data-contract.md).

## 1. Languages

- UI and docs ship in **Uzbek (Latin script, `uz`, default)**, **English (`en`)** and **Russian (`ru`)**.
- Language choice: `?lang=uz|en|ru` in the URL > saved choice (localStorage, wrapped in try/catch) >
  browser language (`ru*` → ru, `uz*` → uz, else en) > `uz`.
- UI strings live in `web/src/i18n/{uz,en,ru}.json`, flat keys (`"layers.title": "Qatlamlar"`), accessed
  with `t(key, vars?)`. A missing key falls back to `en`, then to the key itself; a vitest checks all three
  files have the same key set.
- Object names stay as catalogued (Sirius, M31, Sgr A*); Solar System bodies get translated names
  (`Yer / Earth / Земля`). Numbers use the language's formatting (`Intl.NumberFormat`).
- Uzbek uses the official Latin alphabet with `oʻ`, `gʻ` (U+02BB) and `ʼ` (U+02BC).
- Unit abbreviations (`unit.*`, `facts.unit.*` in the dictionaries):

  | | en | uz | ru |
  |---|---|---|---|
  | astronomical unit | AU | a.b. | а. е. |
  | parsec (k, M, G) | pc, kpc, Mpc, Gpc | pk, kpk, Mpk, Gpk | пк, кпк, Мпк, Гпк |
  | light-year | ly | yorugʻlik yili (written out) | св. год / св. года / св. лет |

  Uzbek: Uzbek Wikipedia writes *yorugʻlik yili* in full and gives "ps" for the parsec (international pc).
  "ps" collides with the SI picosecond, so the atlas uses *pk*, the Latin transliteration of the
  Russian-school *пк* that Soviet-era Uzbek astronomy texts used. Not checked against the current
  11th-grade textbook (its PDF was not machine-readable here); change `unit.*` in `uz.json` if it differs.
- Numbers: Uzbek and Russian write `1 234,5` (no-break space, decimal comma). Chrome's ICU formats the
  `uz` locale like English (`1,234.5`, measured 2026-11-13), so `NUMBER_LOCALES` in `src/i18n/index.ts`
  formats Uzbek with a locale that has the CLDR `uz` separators.
- Deep links inside articles: `[text](doc:slug)` opens another article, `[text](#focus=<name>)` flies to an
  object (catalogue name or alias, Solar System id such as `Earth`, or a named view such as `milky-way`),
  `[text](#layer=<id>)` turns a layer on and flies to a view of it. A vitest resolves every target used.

## 2. Object kinds

Every searchable or clickable thing has a `kind`. The registry is `web/src/objects/kinds.ts`
(id → docs slug, i18n label key, marker colour, label visibility range). New kinds are added there first.

| kind | what | data source | docs slug |
|---|---|---|---|
| `star` | star (Gaia point or named star) | Gaia DR3, IAU WGSN | `star` |
| `wd` | white dwarf | Gaia DR3 | `white-dwarf` |
| `galaxy` | galaxy | DESI, 2MRS, CF4, UNGC | `galaxy` |
| `qso` | quasar | DESI | `quasar` |
| `lg_galaxy` | Local Group galaxy | McConnachie | `local-group` |
| `cluster` | star cluster (open, moving group, globular) | Hunt & Reffert 2023/24, Baumgardt & Vasiliev 2021 (`clusters.json`, merged with OpenNGC names) | `star-cluster` |
| `nebula` | emission / reflection / planetary nebula | OpenNGC + literature distances | `nebula` |
| `snr` | supernova remnant | Green 2024 SNR catalogue + distances | `supernova-remnant` |
| `pulsar` | pulsar / neutron star | ATNF Pulsar Catalogue | `pulsar` |
| `black_hole` | black hole (SMBH, stellar, X-ray binary) | literature (see catalogue `ref`) | `black-hole` |
| `exoplanet` | confirmed exoplanet (drawn at its host star) | NASA Exoplanet Archive `pscomppars` | `exoplanet` |
| `sun`, `planet`, `dwarf_planet`, `moon` | Solar System bodies, live positions | astronomy-engine (VSOP87-based analytic ephemerides, about ±1′; checked against JPL Horizons) | per body, e.g. `earth`, `mars` |
| `spacecraft` | interstellar probes (Voyager 1/2, Pioneer 10/11, New Horizons) | JPL Horizons vectors | `spacecraft` |
| `message` | message sent to the stars (Arecibo 1974, Cosmic Call...) | literature | `interstellar-message` |
| `seti_signal` | candidate signal (Wow! 1977) | literature | `seti` |
| `model` | Milky Way model features | Reid et al. 2019 | `milky-way` |
| `gw_event` | gravitational-wave merger; drawn as its 90 % localisation volume, not a point (GW170817 at its host NGC 4993) | GWOSC GWTC list + LVK sky maps (`gw-events.json`) | `gravitational-waves` |
| `frb` | fast radio burst: host galaxy with a redshift in 3D, all others sky directions only | FRBs/FRB repo hosts, CHIME/FRB Catalog 2 | `fast-radio-burst` |
| `neutrino` | high-energy neutrino: alert directions + 90 % regions; identified sources (TXS 0506+056, NGC 1068) in 3D | IceCat-1, KM3NeT, IceCube papers | `neutrino` |
| `cmb` | the last scattering surface (one entry; drawn as a shell, src/messengers/cmb.ts) | Planck PR3 SMICA | `cmb` |

Kinds `frb` and `neutrino` also have direction-only entries (`xyz: null`) that the viewer loads from
`frb-sky.json` / `neutrino-sky.json` (column tables) after the catalogues; they join the search and the
info card but get no label and no distance (see src/messengers/data.ts).

## 3. Catalogue entries (`data/tiles/catalogs/*.json`)

Same shape as data-contract §4, plus:

```json
{"name": "Gaia BH3", "alt": ["Gaia DR3 4318465066420528000"], "kind": "black_hole",
 "ra": 294.8278, "dec": 14.9306, "dist_pc": 590.6, "dist_lo_pc": 584.8, "dist_hi_pc": 596.4,
 "xyz": [...], "docs": "black-hole",
 "facts": {"mass_msun": [32.70, 0.82], "type": "stellar, dormant", "discovered": 2024},
 "ref": "Gaia Collaboration, Panuzzo et al. 2024, A&A 686, L2", "doi": "10.1051/0004-6361/202449763"}
```

- `docs`: slug of the article the info card links to (defaults to the kind's slug). A specific article
  (`sgr-a-star`, `m87-black-hole`, `crab-nebula`, `proxima-b`, `trappist-1`, `voyager-1`,
  `arecibo-message`, `wow-signal`) wins when it exists.
- `facts`: numbers as `value`, `[value, error]` or `[value, err_minus, err_plus]` (both >= 0), or text
  for limits and ranges (`"≥4.4"`, `"6.9–8.2"`); keys end in their unit (`_msun`, `_mjup`, `_rearth`,
  `_days`, `_s`, `_ms`, `_k`, `_kpc`, `_pc_cm3`, `_ly`, `_mhz`, `_jy`, `_arcmin`, `_deg`, `_jy_ms`, `_uk`, `_kyr`, `_gpc`,
  `_tev`, `_pev`, `_per_yr`). The info card renders
  them with translated labels (`facts.<key>`, falling back to the key; `web/src/objects/facts.ts`).
- Every fact has a citation through `ref`/`doi` (entry-level) or `facts_ref` (per key).
- `exoplanets.json` has one entry per host star with a `planets` array (NASA Exoplanet Archive column
  names; numbers follow the archive's `[value, err1, err2]` with `err2 <= 0`); the viewer adds the planet
  names to the search aliases. Kinds `exoplanet`, `pulsar`, `black_hole`, `message`, `seti_signal` are
  de-duplicated only against their own kind (a planet system shares its name with its star).
- Text facts in `facts.val.<slug>` (slug = lower case, non-alphanumerics → `_`, e.g. `facts.val.open_cluster`)
  are shown translated; other text is shown as catalogued.
- `clusters.json` loads before `messier-ngc.json` (layers.json order): its Messier/NGC-named clusters
  replace those entries. A cluster whose NGC/IC number is also a nebula in an earlier file is named
  `<name> cluster`. `gw-events.json` entries carry `loc` (ellipsoids of the 90 % volume, see
  `scripts/build_gw.py`), `gwosc` (event page) and, for GW170817, `host`.
- Each catalogue is built by `scripts/build_<name>.py` (black_holes, exoplanets, pulsars, nebulae_snr,
  seti, clusters, gw); its provenance block (sources, queries, counts, citations) is written next to it,
  `data/tiles/catalogs/provenance/<name>.json`; downloads are cached in `data/cache/` (gitignored).

## 4. Docs articles (`web/public/docs/<lang>/<slug>.md`)

Markdown with front matter:

```markdown
---
title: Qora tuynuk
summary: Tortishish kuchi shu qadar kuchliki, undan hatto yorugʻlik ham chiqa olmaydigan hudud.
related: [neutron-star, pulsar, sgr-a-star, gaia-mission]
sources:
  - Event Horizon Telescope Collaboration 2022, ApJL 930, L12 (doi:10.3847/2041-8213/ac6674)
  - https://science.nasa.gov/universe/black-holes/
updated: 2026-11-13
---

## Bu nima?
...
## Qanday topiladi?
...
## Atlasda qayerda?
(what the reader can find in this map, with deep links like [Sgr A*](#focus=sgr-a-star))
```

- `summary` (≤ 160 characters) is what the small info card shows; "Batafsil / Learn more / Подробнее"
  opens the full article in the in-app docs panel (`#doc=<slug>`), which also has an index page `index.md`.
- Level: curious secondary-school reader; one idea per paragraph; numbers with units; no unexplained jargon
  (link the concept article instead, e.g. `[parallaks](doc:parallax)`).
- Facts must come from the cited sources. No images unless public domain or CC with credit in the caption.
- Same slug set in all three languages; a test fails if a slug is missing in one of them.

### Slug list v1

Concepts: `index`, `how-to-use`, `units` (AU, light-year, parsec), `parallax`, `magnitude`, `redshift`,
`lookback-time`, `distance-uncertainty`, `gaia-mission`, `desi-survey`, `cosmic-web`.
Kinds: `star`, `white-dwarf`, `galaxy`, `quasar`, `local-group`, `milky-way`, `star-cluster`, `nebula`,
`supernova-remnant`, `pulsar`, `neutron-star`, `black-hole`, `exoplanet`, `spacecraft`,
`interstellar-message`, `seti`, `gravitational-waves`, `fast-radio-burst`, `neutrino`.
Sky and the early universe: `x-ray-sky`, `cmb`.
Solar System: `solar-system`, `sun`, `mercury`, `venus`, `earth`, `moon`, `mars`, `jupiter`, `saturn`,
`uranus`, `neptune`, `pluto`, `asteroid-belt`.
Highlights: `sgr-a-star`, `m87-black-hole`, `gaia-bh3`, `crab-nebula`, `proxima-b`, `trappist-1`,
`voyager-1`, `arecibo-message`, `wow-signal`.
