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
