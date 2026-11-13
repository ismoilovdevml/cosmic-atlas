# Fact check: concept and kind articles

Every number used in the concept and kind articles under `web/public/docs/{uz,en,ru}/` and the source
it was taken from. The three languages state the same facts. "Atlas" sources are this repository's
own data (catalogues in `data/tiles/catalogs/`, `data/raw/*/PROVENANCE.json`) or code. "Computed"
means arithmetic on the cited values (shown in the claim column). Sources were opened on 2026-11-13.

## Re-check log

See the end of this file for the sources re-opened after writing.

## Table

| slug | claim | value | source |
|---|---|---|---|
| how-to-use | wheel zoom per notch | about 1.25× | web/README.md (Controls) |
| how-to-use | fly faster with Shift | 4× | web/README.md (Controls) |
| how-to-use | point budget range, default | 0.5–12 M, 4 M | web/index.html (`#budget`), web/README.md |
| how-to-use | thin slab half-thickness range | ±10 to ±300 Mpc | web/index.html (`#slab`), web/README.md |
| how-to-use | scale rail range | about 0.04 au to 30 Gpc | web/src/ui/rail.ts (RAIL_MIN = log10(2e-7 pc), RAIL_MAX = log10(3e10 pc)) |
| how-to-use | scale tour stops | 6 | web/src/tour/tours.ts (SCALE_TOUR) |
| how-to-use | distance range on card | 16th–84th percentile | web/src/main.ts, docs/data-contract.md §2 |
| how-to-use | languages | uz, en, ru via ?lang= | docs/content-contract.md §1 |
| index | slug list | 27 concept/kind + 13 Solar System + 9 highlights | docs/content-contract.md §4 |
| star | Sun radius | 695,700 km (≈109 × Earth) | NASA Sun Fact Sheet |
| star | Sun mass | ≈2 × 10^30 kg (1,988,400 × 10^24 kg) | NASA Sun Fact Sheet |
| star | Sun effective temperature | 5,772 K | NASA Sun Fact Sheet |
| star | Sun about halfway through its stable life | — | NASA Science, Stars |
| star | star-forming cloud mass | 1,000 to 10 million solar masses | NASA Science, Stars |
| star | stellar lifetimes | few million to trillions of years | NASA Science, Stars |
| star | stars in the universe | up to one septillion (10^24) | NASA Science, Stars |
| star | stars in the Milky Way | more than 100 billion | NASA Science, Stars |
| star | Proxima mass, luminosity | ≈12 % of Sun, ≈0.1 % of Sun | Anglada-Escudé et al. 2016 (arXiv:1609.03449) abstract |
| star | Proxima distance | 1.30 pc = 4.25 ly (computed from parallax 768.0665 mas) | Gaia DR3 via VizieR I/355/gaiadr3 |
| star | Proxima apparent magnitude | 11.13 (too faint for naked eye, limit ≈6) | atlas named-stars.json (SIMBAD V); LCO magnitude page |
| star | named stars in atlas | 653 | data/raw/named-stars/PROVENANCE.json (IAU WGSN) |
| star | Gaia layer limit | 1 kpc | README.md, scripts/fetch_gaia.py |
| galaxy | largest galaxies | trillions of stars, > 1 million ly across | NASA Science, Galaxies |
| galaxy | galaxy groups / clusters | up to ~100 members / thousands | NASA Science, Galaxies |
| galaxy | Hubble finds Cepheid V1 in M31 | night of 5–6 Oct 1923 | NASA Science, Hubble views the star that changed the universe |
| galaxy | Hubble's distances to M31 | ≈1 million ly (V1), 900,000 ly (12 Cepheids, end 1924) | same NASA page |
| galaxy | M31 distance in atlas | 783 kpc ≈ 2.55 million ly (light ≈2.6 Myr) | atlas local-group.json / messier-ngc.json (McConnachie 2012); computed ×3.2616 |
| galaxy | M31 naked-eye | V = 3.44 < 6 | atlas messier-ngc.json; LCO naked-eye limit |
| galaxy | galaxies in observable universe | ≈2 trillion (2.0 +0.7/−0.6 × 10^12), extrapolation | Conselice et al. 2016 abstract |
| galaxy | DESI layer counts | 13,556,136 galaxies, 1,583,866 QSOs | data/raw/galaxies-desi/PROVENANCE.json |
| galaxy | 2MRS / CF4 / LV counts | 43,463 / 55,877 / 868 | README.md layer table, PROVENANCE.json |
| galaxy | M51, M104, M87 distances | 8.34, 9.3, 16.86 Mpc | atlas messier-ngc.json (refs per entry; M87 from CF4) |
| galaxy | M87 giant elliptical | — | EHT 2019 Paper I abstract (arXiv:1906.11238) |
| black-hole | core > ≈3 M☉ collapses to a black hole | 1–3 M☉ → neutron star | NASA Imagine, Neutron stars |
| black-hole | Sgr A* mass (S2 orbit) | 4.297 ± 0.013 million M☉ | GRAVITY 2021 (arXiv:2101.12098) Table 2 |
| black-hole | Gaia BH1 | 9.62 ± 0.18 M☉, 480 pc, P = 185.6 d, nearest known by factor 3 (2022) | El-Badry et al. 2023 (arXiv:2209.06833) abstract |
| black-hole | Gaia BH3 | 32.70 ± 0.82 M☉, 590 pc, most massive Galactic stellar-origin BH (2024) | Panuzzo et al. 2024 (arXiv:2404.10486) abstract |
| black-hole | GW150914 | 14 Sep 2015; 36 + 29 → 62 M☉; 3.0 M☉c² radiated; 410 Mpc luminosity distance | LIGO/Virgo 2016 (arXiv:1602.03837) abstract |
| black-hole | M87* mass, ring | 6.5 ± 0.7 × 10^9 M☉; 42 ± 3 µas | EHT 2019 Paper I abstract |
| black-hole | Sgr A* EHT | ring 51.8 ± 2.3 µas; ~4 × 10^6 M☉; 2017 data, published 2022 | EHT 2022 Paper I (arXiv:2311.08680) abstract |
| black-hole | M87*/Sgr A* mass ratio | ≈1,500 (computed 6.5e9 / 4.297e6) | computed |
| black-hole | Gaia BH3 distance in ly | ≈1,900 ly (computed 590 × 3.2616) | computed |
| black-hole | M87 distance in atlas | 16.9 Mpc | atlas messier-ngc.json (Cosmicflows-4) |
| exoplanet | confirmed exoplanets | 6,470 (as of 12 Nov 2026) | NASA Exoplanet Archive home page |
| exoplanet | billions believed to exist; 4 families; microlensing, transits | — | NASA Science, Exoplanets |
| exoplanet | 51 Peg b | announced Oct 1995; P = 4.2 d; a ≈ 0.052 au; mass 0.46 and 0.61 M_Jup both listed; radial velocity | NASA Science, 51 Pegasi b |
| exoplanet | 2019 Nobel Prize, Mayor & Queloz | "discovery of an exoplanet orbiting a solar-type star" | nobelprize.org 2019 summary |
| exoplanet | PSR B1257+12 planets | c, d in 1992 (Wolszczan et al.), b in 1994; pulsar timing | NASA Exoplanet Archive system overview |
| exoplanet | Proxima b | min. 1.3 M⊕, P ≈ 11.2 d, a ≈ 0.05 au, liquid-water temperature range (2016) | Anglada-Escudé et al. 2016 abstract |
| exoplanet | TRAPPIST-1 | ≥7 Earth-sized planets, 12 pc, 0.08 M☉, inner six P = 1.51–12.35 d | Gillon et al. 2017 abstract |
| exoplanet | 51 Peg (Helvetios) distance | 15.5 pc | atlas named-stars.json (Gaia DR3) |
| pulsar | neutron star size | ≈20 km | NASA Imagine, Neutron stars |
| pulsar | pulse intervals | milliseconds to seconds | NASA Imagine, Neutron stars |
| pulsar | Bell Burnell's first signal; confirmed | 6 Aug 1967; November 1967; "a bit more than a second" | National Geographic article |
| pulsar | first pulsar period | 1.337302 s (PSR J1921+2153 = B1919+21) | ATNF Pulsar Catalogue v2.9.0 query |
| pulsar | LGM-1 nickname by Hewish | — | National Geographic article |
| pulsar | 1974 Nobel Prize | Ryle and Hewish, "decisive role in the discovery of pulsars" | nobelprize.org 1974 summary |
| pulsar | pulsars in ATNF catalogue | 4,503 (v2.9.0, queried 2026-11-13) | ATNF psrcat query (count of rows) |
| pulsar | fastest pulsar | 716 Hz, PSR J1748−2446ad, Terzan 5, radius < 16 km | Hessels et al. 2006 abstract |
| pulsar | equator speed | ≤ 0.24 c (computed 2π × 16 km × 716 /s = 72,000 km/s) | computed |
| pulsar | Crab pulsar spin | 30 times/s (P0 = 0.033392 s) | NASA Hubble Crab page; ATNF J0534+2200 |
| pulsar | Pioneer 10 plaque, 14 pulsars | — | NASA Science, Pioneer 10 |
| pulsar | Crab distance in atlas | 2.0 kpc | atlas messier-ngc.json (SIMBAD) ; ATNF DIST 2.000 kpc |
| nebula | nebula types (emission red from ionised H, reflection, dark, planetary); Pillars of Creation photographed by Hubble 1995; M42 smudge below Orion's belt | — | BBC Sky at Night beginner's guide to nebulae |
| nebula | molecular clouds | 1,000–10 million M☉, hundreds of ly | NASA Science, Stars |
| nebula | M42 | closest large star-forming region; V = 4.0; ≈1,500 ly (NASA); four Trapezium stars | NASA Hubble Messier 42 page |
| nebula | M42 distance in atlas | 433 pc ≈ 1,410 ly | atlas messier-ngc.json (SIMBAD mesDistance) |
| nebula | M57 | ≈2,000 ly (NASA) vs 787 pc ≈ 2,570 ly (atlas) | NASA Hubble Messier 57 page; atlas messier-ngc.json |
| nebula | planetary nebula name by Herschel, look like Uranus | — | ESA/Hubble potw1250a |
| nebula | Merope reflection nebula destroyed by radiation | — | NASA Hubble Messier 45 page |
| nebula | M8, M16, NGC 7293 distances | 1.27, 1.69 kpc, 200 pc | atlas messier-ngc.json |
| nebula | M78, M43 without distance | — | data/raw/messier-ngc/PROVENANCE.json (no_distance list) |
| units | astronomical unit | 149,597,870,700 m exactly | IAU 2012 Resolution B2 (via astropy.constants.au reference) |
| units | parsec | 648,000/π au exactly ≈ 206,265 au ≈ 3.0857 × 10^16 m ≈ 3.2616 ly | Mamajek et al. 2015 (arXiv:1510.06262) abstract; astropy.constants.pc |
| units | light-year | c × Julian year = 9,460,730,472,580,800 m ≈ 63,241 au | SI c = 299,792,458 m/s; astropy units (computed) |
| units | sunlight travel time | 499.005 s (computed 1 au / c) | computed |
| units | Proxima parallax / distance | 768.0665 ± 0.0499 mas → 1.302 pc = 4.25 ly | Gaia DR3 via VizieR I/355/gaiadr3 |
| units | 1 arcsec = coin (≈2 cm) at ≈4 km | 4,000 m × 4.848e-6 rad = 1.9 cm | computed |
| units | rail range | ≈0.04 au to 30 Gpc (> 20 decades) | web/src/ui/rail.ts |
| units | Sirius, Pleiades, M31 | 2.64 pc, 134.8 pc, 0.783 Mpc | atlas named-stars.json (Hipparcos 2007), messier-ngc.json |
| parallax | Earth orbit baseline | ≈300 million km (2 au) | computed from 1 au |
| parallax | first parallaxes | 1830s; Bessel 61 Cygni 1838; Henderson α Cen; von Struve Vega | Reid & Menten 2020 (arXiv:2009.11913) text |
| parallax | Struve Vega 0.125″ then doubled; two dimensions combined by luck | — | Reid & Menten 2020 abstract |
| parallax | Gaia DR3 parallaxes | 1,467,744,818 sources | ESA Gaia DR3 page |
| parallax | Gaia DR3 precision | 0.02–0.03 mas (G<15), 0.07 (G=17), 0.5 (G=20), 1.3 (G=21) | ESA Gaia DR3 page |
| parallax | Bailer-Jones distances | 1.47 billion geometric, 1.35 billion photogeometric | Bailer-Jones et al. 2021 abstract |
| parallax | atlas Gaia cut | parallax/error > 10, RUWE < 1.4, d < 1 kpc | scripts/fetch_gaia.py (CHOSEN_WHERE, MAX_DIST_PC) |
| parallax | Barnard's Star, Deneb | 1.83 pc (Gaia DR3), 433 pc (Hipparcos 2007) | atlas named-stars.json |
| parallax | Gaia bright limit | G ≈ 3 | ESA Gaia DR3 page; README (stars-bright layer) |
| redshift | Hubble velocity–distance relation | 1929, PNAS 15, 168 | PMC522427 record |
| redshift | z → comoving distance, lookback (Planck18) | z=0.01: 44 Mpc, 0.14 Gyr; 0.1: 433 Mpc, 1.3 Gyr; 0.5: 1.95 Gpc, 5.2 Gyr; 1: 3.40 Gpc, 7.9 Gyr; 2: 5.31 Gpc, 10.5 Gyr | computed with astropy 7 Planck18 (Planck 2018 VI) |
| redshift | 3C 273 | z = 0.158, Schmidt 1963, 200-inch Palomar; occultations at Parkes 1962 | Kellermann 2013 abstract (z ≈ 0.16); Schmidt 1963 value 0.158 |
| redshift | DESI simultaneous spectra | 5,000 | Fermilab DR1 press release |
| redshift | DESI layer z distribution | 75 % z < 1; 6,120 objects z ≥ 4; max z = 6.80 | computed from data/raw/galaxies-desi parquet and PROVENANCE.json z histogram |
| redshift | galaxy colour ramp | ivory z=0 → rose → violet z≥1.5; QSO pale cyan | pipeline/build_tiles.py galaxy_rgb |
| redshift | redshift distances not used below | z = 0.003 (≈13.3 Mpc) | docs/data-contract.md §1; astropy Planck18 |
| redshift | readout switches to Planck18 beyond | 10 Mpc | web/src/math/units.ts describeLookback |
| magnitude | Hipparchus 1st–6th magnitude, no Sun/Moon/planets | — | LCO, What is apparent magnitude? |
| magnitude | Pogson: 5 mag = factor 100; 1 mag = 2.512 | — | LCO, Comparing magnitudes |
| magnitude | Sun apparent / absolute V | −26.74 / +4.83 | NASA Sun Fact Sheet |
| magnitude | table: Sun −26.7, full Moon −12.6, naked eye +6 (dark) / +3 (city), Hubble faintest ≈ +30 | — | LCO, What is apparent magnitude? (table) |
| magnitude | Sirius V, Vega V | −1.46, 0.03 | atlas named-stars.json (SIMBAD) |
| magnitude | 24 mag = factor ≈ 4 billion | 10^(0.4×24) = 3.98 × 10^9 | computed |
| magnitude | Gaia range | G ≈ 3 to 21 | ESA Gaia DR3 page |
| magnitude | brightness code M ignores extinction | — | docs/data-contract.md §3 (lum code) |
| magnitude | Exposure slider | −4 to +6 mag | web/index.html (`#exposure`) |
| lookback-time | light travel: Sun, Proxima, M31 | ≈8.3 min (499 s), 4.2 yr (4.25), ≈2.6 Myr (783 kpc) | computed from NASA Sun Fact Sheet/au, Gaia DR3 parallax, atlas M31 distance |
| lookback-time | age of the universe (Planck18) | 13.79 Gyr (astropy 13.787) | Planck 2018 VI; astropy Planck18 |
| lookback-time | z=0.1 / 1 / 3 / 6.8: lookback, age then, comoving | 1.3/12.4 Gyr/0.43 Gpc; 7.9/5.9/3.40; 11.6/2.1/6.50; 13.0/0.79/8.74 (=28.5 Gly) | computed with astropy Planck18 |
| lookback-time | CMB released | ≈380,000 yr after Big Bang | NASA Science, Universe overview |
| lookback-time | J0313−1806 | z = 7.642, ≈670 Myr after Big Bang, BH 1.6 × 10^9 M☉ (2021) | Wang et al. 2021 abstract |
| lookback-time | readout: d/c below 10 Mpc, Planck18 beyond | — | web/src/math/units.ts describeLookback |
| distance-uncertainty | 16th–84th percentile ≈ ±1σ (68 %) | — | docs/data-contract.md §2; Bailer-Jones et al. 2021 (quantiles) |
| distance-uncertainty | Bailer-Jones geometric distances, asymmetric uncertainties, Galaxy-model prior | 1.47 billion stars | Bailer-Jones et al. 2021 abstract |
| distance-uncertainty | DESI distance range = comoving distance of z ∓ zerr | — | data/raw/galaxies-desi/PROVENANCE.json (columns) |
| distance-uncertainty | no Hubble-flow distance below | z = 0.003 ≈ 13.3 Mpc | docs/data-contract.md §1; astropy Planck18 |
| distance-uncertainty | peculiar velocity = departure from cosmic expansion | — | Tully et al. 2014 abstract |
| distance-uncertainty | 10 % distance error → ≈20 % luminosity error | L ∝ d² | computed |
| distance-uncertainty | G=20 star at 1 kpc: 1 mas parallax, 0.5 mas error (50 %); bright star 0.02–0.03 mas (2–3 %) | — | ESA Gaia DR3 page precision; computed |
| distance-uncertainty | uncertainty streaks limited to 32 nodes; dashed bar when no upper bound | — | web/README.md (Distance uncertainty) |
| gaia-mission | launch | 19 Dec 2013 | ESA Gaia overview; ESA fact sheet (09:12 UTC) |
| gaia-mission | orbit | Sun–Earth L2, ≈1.5 million km from Earth | ESA Gaia fact sheet |
| gaia-mission | focal plane | 106 CCDs, ≈1 billion pixels, two telescopes | ESA fact sheet (106 CCDs); ESA overview ("1 billion pixel camera") |
| gaia-mission | DR3 | 13 Jun 2022; 34 months (25 Jul 2014–28 May 2017); 1,811,709,771 sources; 1,467,744,818 with parallax+PM; 33,812,183 RVs | ESA Gaia DR3 page |
| gaia-mission | 0.025 mas ≈ 4.7 cm at the Moon's distance | 384,400 km × 0.025e-3/206265 | computed |
| gaia-mission | end of science observations | 15 Jan 2025 | ESA Gaia overview |
| gaia-mission | switched off, retirement orbit | 27 Mar 2025 | ESA "Farewell Gaia!" |
| gaia-mission | > 3 trillion observations; ≈1,500 names in memory; asteroids, galaxies, quasars | — | ESA "Farewell Gaia!" |
| gaia-mission | DR4 | 66 months, expected December 2026 | ESA Gaia overview |
| gaia-mission | final release | not before end of 2030 | ESA Gaia overview |
| gaia-mission | Gaia BH3 found in DR4 validation | 32.7 M☉, 590 pc (2024) | Panuzzo et al. 2024 abstract |
| gaia-mission | 1 kpc in ly | 3,262 ly | computed |
| desi-survey | telescope | Mayall 4-m, Kitt Peak, Arizona | Fermilab DR1 press release; DESI home page |
| desi-survey | fibres, cadence | 5,000; new set ≈ every 20 min in clear weather | Fermilab DR1 press release |
| desi-survey | main survey start; DR1 span; DR1 release | May 2021; first 13 months (to June 2022) + SV; 19 Mar 2025 | arXiv:2503.14745 abstract; Fermilab release |
| desi-survey | DR1 content | 18.7 M (13.1 M galaxies, 1.6 M QSOs, 4 M stars) | arXiv:2503.14745 abstract; Fermilab release |
| desi-survey | DR1 map reaches galaxies seen ≈11 Gyr ago | — | Fermilab DR1 press release |
| desi-survey | four samples BGS, LRG, ELG, QSO | — | arXiv:2503.14745 Fig. 1 caption |
| desi-survey | DR1 > 2× all previous 3D surveys; SDSS 9 M objects in ≈25 yr; > 100,000 galaxies a night; 270 TB | — | Fermilab DR1 press release |
| desi-survey | planned survey completed | April 2026; > 47 M galaxies+QSOs vs target 34 M; continues through 2028 | IFAE news 15 Apr 2026 |
| local-group | > 100 galaxies within 3 Mpc | — | McConnachie 2012 abstract |
| local-group | next most massive members M33 and LMC; merger "in around five billion years" commonly believed; ≈50 % chance of no merger in 10 Gyr | — | Sawala et al. 2024 (arXiv:2408.00064) abstract |
| local-group | LMC distance (20 eclipsing binaries) | 49.59 ± 0.09 (stat) ± 0.54 (sys) kpc | Pietrzyński et al. 2019 abstract |
| local-group | LMC/SMC in atlas | 50.6 kpc (48.5–52.7), V = 0.4; 64.0 kpc, V = 2.2 | atlas local-group.json (McConnachie Jan 2021) |
| local-group | LMC light travel | ≈160,000 yr (computed 49.59 kpc × 3.2616) | computed |
| local-group | M31, M33, Sgr dSph distances | 783, 809, 26.3 kpc | atlas local-group.json |
| local-group | layer sizes | 146 (local-group), 868 (UNGC) | PROVENANCE.json of both layers |
| local-group | Hubble's Cepheid in M31, 1923 | — | NASA Hubble V1 page |
| quasar | 3C 273: 1962 lunar occultations at Parkes; 13th-mag counterpart photographed by 1887; Schmidt's 200-inch spectrum; z = 0.158 (1963); acceptance not universal for decades | — | Kellermann 2013 abstract |
| quasar | J0313−1806 | z = 7.642; L_bol = 3.6 × 10^13 L☉ (36 trillion); BH 1.6 × 10^9 M☉; ≈670 Myr after Big Bang; challenges BH growth models | Wang et al. 2021 abstract |
| quasar | M87* 6.5 × 10^9 M☉; SMBHs as central engines of AGN | — | EHT 2019 Paper I abstract |
| quasar | atlas QSOs | 1,583,866; every object with z > 2 is a QSO; galaxies max z = 1.70; QSO max z = 6.80 (lookback 13.0 Gyr) | computed from data/raw/galaxies-desi parquet; astropy Planck18 |
| quasar | QSO colour pale cyan (150, 230, 255) | — | pipeline/build_tiles.py galaxy_rgb |
| white-dwarf | new WD temperature; typical mass; size; density; surface gravity; Chandrasekhar limit; Sun's fate | > 100,000 K; ≈0.5 M☉; slightly larger than Earth; 10^9 kg/m³ (≈200,000 × Earth); ≈100,000 g; 1.4 M☉ | NASA Imagine, White dwarf stars |
| white-dwarf | teaspoon mass | 5 ml × 10^9 kg/m³ = 5 t | computed |
| white-dwarf | Sirius B | seen 1862; 98 % M☉; ≈12,000 km; mass from gravitational redshift (Hubble 2005) | ESA/Hubble heic0516 |
| white-dwarf | WD candidates in Gaia EDR3 | ≈359,000 high-confidence | Gentile Fusillo et al. 2021 abstract |
| white-dwarf | crystallisation pile-up delays cooling | ≈1 Gyr | Tremblay et al. 2019 abstract |
| white-dwarf | final stage of the vast majority of stars | — | Althaus et al. 2010 abstract |
| white-dwarf | Kepler's SN 1604 was type Ia (white dwarf) | — | NASA Chandra Kepler page |
| white-dwarf | atlas WD flag | M_G > 10 + 2.6 (BP−RP), BP−RP < 1.6, no extinction | scripts/fetch_gaia.py (WD_A, WD_B, WD_MAX_COLOR) |
| cosmic-web | "large-scale backbone of the cosmos", primarily dark matter; filaments bound voids; gas filaments > 10 million ly; 37,000 SDSS galaxies, 350 quasars | — | NASA Science, slime mold simulations article |
| cosmic-web | "A slice of the universe" | de Lapparent, Geller & Huchra 1986, ApJ 302, L1 | Crossref record for doi:10.1086/184625 |
| cosmic-web | Laniakea defined by peculiar-velocity flows | 2014 | Tully et al. 2014 abstract |
| cosmic-web | Laniakea size, galaxies, mass, name | ≈500 million ly; ≈100,000 galaxies; 10^17 M☉; "immense heaven" | NRAO news page |
| cosmic-web | slab settings shown on real DESI | ±25 Mpc at 200 Mpc; ±75 Mpc at 1 Gpc | web/README.md (Thin slab) |
| cosmic-web | CF4 layer | 55,877 galaxies | data/raw/galaxies-cf4/PROVENANCE.json |
| desi-survey | atlas DESI layer | 15,140,002 = 13,556,136 galaxies + 1,583,866 QSOs; cuts ZWARN=0, DELTACHI2>25, no stars, z ≥ 0.003 | data/raw/galaxies-desi/PROVENANCE.json |
