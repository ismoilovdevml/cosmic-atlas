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
| `cluster` | star cluster | OpenNGC / Hunt & Reffert / Baumgardt | `star-cluster` |
| `nebula` | emission / reflection / planetary nebula | OpenNGC + literature distances | `nebula` |
| `snr` | supernova remnant | Green 2024 SNR catalogue + distances | `supernova-remnant` |
| `pulsar` | pulsar / neutron star | ATNF Pulsar Catalogue | `pulsar` |
| `black_hole` | black hole (SMBH, stellar, X-ray binary) | literature (see catalogue `ref`) | `black-hole` |
| `exoplanet` | confirmed exoplanet (drawn at its host star) | NASA Exoplanet Archive `pscomppars` | `exoplanet` |
| `sun`, `planet`, `dwarf_planet`, `moon` | Solar System bodies, live positions | JPL-derived ephemerides (astronomy-engine) | per body, e.g. `earth`, `mars` |
| `spacecraft` | interstellar probes (Voyager 1/2, Pioneer 10/11, New Horizons) | JPL Horizons vectors | `spacecraft` |
| `message` | message sent to the stars (Arecibo 1974, Cosmic Call...) | literature | `interstellar-message` |
| `seti_signal` | candidate signal (Wow! 1977) | literature | `seti` |
| `model` | Milky Way model features | Reid et al. 2019 | `milky-way` |

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
  `_days`, `_s`, `_ms`, `_k`, `_kpc`, `_pc_cm3`, `_ly`, `_mhz`, `_jy`, `_arcmin`). The info card renders
  them with translated labels (`facts.<key>`, falling back to the key; `web/src/objects/facts.ts`).
- Every fact has a citation through `ref`/`doi` (entry-level) or `facts_ref` (per key).
- `exoplanets.json` has one entry per host star with a `planets` array (NASA Exoplanet Archive column
  names; numbers follow the archive's `[value, err1, err2]` with `err2 <= 0`); the viewer adds the planet
  names to the search aliases. Kinds `exoplanet`, `pulsar`, `black_hole`, `message`, `seti_signal` are
  de-duplicated only against their own kind (a planet system shares its name with its star).
- Each catalogue is built by `scripts/build_<name>.py` (black_holes, exoplanets, pulsars, nebulae_snr,
  seti); its provenance block (sources, queries, counts, citations) is written next to it,
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
`interstellar-message`, `seti`.
Solar System: `solar-system`, `sun`, `mercury`, `venus`, `earth`, `moon`, `mars`, `jupiter`, `saturn`,
`uranus`, `neptune`, `pluto`, `asteroid-belt`.
Highlights: `sgr-a-star`, `m87-black-hole`, `gaia-bh3`, `crab-nebula`, `proxima-b`, `trappist-1`,
`voyager-1`, `arecibo-message`, `wow-signal`.
