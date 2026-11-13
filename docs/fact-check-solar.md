# Fact check: Solar System and highlight articles

Every number used in `web/public/docs/{uz,en,ru}/<slug>.md` for the slugs below, with its source.
The three languages carry the same facts. Compiled 2026-11-13.

"Derived" means computed by us from the cited inputs; the formula is given. Rounding in the articles
follows the precision of the source.

## Source keys

| key | source |
|---|---|
| NSSDC-T | NASA Planetary Fact Sheet, metric table, last updated 18 Mar 2025. https://nssdc.gsfc.nasa.gov/planetary/factsheet/ |
| NSSDC-sun … NSSDC-pluto | Individual NSSDC fact sheets, `https://nssdc.gsfc.nasa.gov/planetary/factsheet/<body>fact.html` (sunfact 9 May 2024, earthfact 15 Nov 2024, moonfact/venusfact 11 Jan 2024) |
| NSSDC-apollo | https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo.html |
| IAU-2015-B3 | Prša et al. 2016, AJ 152, 41, doi:10.3847/0004-6256/152/2/41 (IAU 2015 Resolution B3, nominal solar values) |
| IAU-AU | IAU 2012 Resolution B2: 1 au = 149,597,870,700 m (exact) |
| NASA-sun | https://science.nasa.gov/sun/facts/ |
| NASA-mercury, -venus, -earth, -moon, -mars, -jupiter, -saturn, -uranus, -neptune | `https://science.nasa.gov/<body>/facts/` |
| NASA-pluto | https://science.nasa.gov/dwarf-planets/pluto/facts/ |
| NASA-ceres | https://science.nasa.gov/dwarf-planets/ceres/facts/ |
| NASA-dwarf | https://science.nasa.gov/dwarf-planets/ |
| NASA-asteroids | https://science.nasa.gov/solar-system/asteroids/facts/ |
| NASA-oort | https://science.nasa.gov/solar-system/oort-cloud/facts/ |
| NASA-moons-J/S/U/N | https://science.nasa.gov/jupiter/jupiter-moons/ (updated 21 Sep 2026), https://science.nasa.gov/saturn/moons/ (22 Sep 2026), https://science.nasa.gov/uranus/moons/ (22 Sep 2026), https://science.nasa.gov/neptune/neptune-moons/ (21 Sep 2026) |
| JPL-sats | https://ssd.jpl.nasa.gov/sats/discovery.html (discovery circumstances) |
| JPL-SBDB | JPL Small-Body Database Query API, https://ssd-api.jpl.nasa.gov/sbdb_query.api (queried 2026-11-13) and class definitions https://ssd-api.jpl.nasa.gov/doc/sbdb_filter.html |
| Connelly2012 | Connelly et al. 2012, Science 338, 651, doi:10.1126/science.1226919 |
| Pitjeva2018 | Pitjeva & Pitjev 2018, "Mass of the Kuiper Belt", Astron. Lett. 44, 554; arXiv:1810.09771 |
| uzwiki | Uzbek Wikipedia lead sections (text from Oʻzbekiston Milliy Ensiklopediyasi): https://uz.wikipedia.org/wiki/Merkuriy , /Venera_(sayyora) , /Mars , /Yupiter , /Saturn |
| arxivuz | https://arxiv.uz/uz/documents/referatlar/astronomiya/yer-tipidagi-planetalarning-fizik-tabiatlari-merkuriy-vinera-yer-oy |
| GRAVITY2018 | GRAVITY Collab. 2018, A&A 615, L15, doi:10.1051/0004-6361/201833718 |
| GRAVITY2020 | GRAVITY Collab. 2020, A&A 636, L5, doi:10.1051/0004-6361/202037813 |
| GRAVITY2022 | GRAVITY Collab. 2022, A&A 657, L12, doi:10.1051/0004-6361/202142465 |
| EHT-SgrA-I | EHT Collab. 2022, ApJL 930, L12, doi:10.3847/2041-8213/ac6674 |
| ESO2208 | ESO press release eso2208, 12 May 2022, https://www.eso.org/public/news/eso2208-eht-mw/ |
| EHT-M87-I | EHT Collab. 2019, ApJL 875, L1, doi:10.3847/2041-8213/ab0ec7 |
| NASA-M87 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-87/ |
| Panuzzo2024 | Gaia Collab., Panuzzo et al. 2024, A&A 686, L2, doi:10.1051/0004-6361/202449763 |
| Hester2008 | Hester 2008, ARA&A 46, 127, doi:10.1146/annurev.astro.45.051806.110608 |
| ATNF | ATNF Pulsar Catalogue v2.6.0, PSR B0531+21, https://www.atnf.csiro.au/research/pulsar/psrcat/ (Manchester et al. 2005, AJ 129, 1993) |
| NASA-M1 | https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-1/ |
| AE2016 | Anglada-Escudé et al. 2016, Nature 536, 437, doi:10.1038/nature19106 |
| Faria2022 | Faria et al. 2022, A&A 658, A115, doi:10.1051/0004-6361/202142337 |
| SM2025 | Suárez Mascareño et al. 2025, A&A 700, A11 (2025A&A...700A..11M), arXiv:2507.21751 |
| NEA | NASA Exoplanet Archive `pscomppars` / `ps`, queried 2026-11-13, https://exoplanetarchive.ipac.caltech.edu |
| Agol2021 | Agol et al. 2021, PSJ 2, 1, doi:10.3847/psj/abd022 |
| Gillon2017 | Gillon et al. 2017, Nature 542, 456, doi:10.1038/nature21360 |
| Greene2023 | Greene et al. 2023, Nature 618, 39, doi:10.1038/s41586-023-05951-7 |
| Zieba2023 | Zieba et al. 2023, Nature 620, 746, doi:10.1038/s41586-023-06232-z |
| NASA-V1 | https://science.nasa.gov/mission/voyager/voyager-1/ (read 2026-11-13) |
| Horizons | JPL Horizons API, target -31 (Voyager 1), queried 2026-11-13, https://ssd.jpl.nasa.gov/horizons/ |
| NAIC1975 | Staff at the NAIC 1975, "The Arecibo message of November, 1974", Icarus 26, 462, doi:10.1016/0019-1035(75)90116-5 |
| Cornell1999 | Cornell Chronicle, 12 Nov 1999, https://news.cornell.edu/stories/1999/11/25th-anniversary-first-attempt-phone-et-0 |
| NSF2020 | NSF news, 1 Dec 2020, https://www.nsf.gov/news/arecibo-observatorys-305-meter-telescope-suffers |
| BV2021 | Baumgardt & Vasiliev 2021 (M13 distance 7.42 kpc, as used in this atlas: `data/tiles/catalogs/messier-ngc.json`) |
| Ehman | J. R. Ehman, "The Big Ear Wow! Signal: What We Know and Don't Know About It After 30 Years", https://www.bigear.org/Wow30th/wow30th.htm |
| Mendez2024 | Méndez, Ortiz Ceballos & Zuluaga 2024, "Arecibo Wow! I", arXiv:2408.08513 |
| Mendez2025 | Méndez et al. 2025, "Arecibo Wow! II", arXiv:2508.10657 |

Constants for derived values: GM☉ = 1.32712440018e20 m³ s⁻², c = 299,792,458 m s⁻¹, 1 pc = 3.26156 ly,
1 ly = 9.4607e12 km, 1 au = 149,597,870.7 km.

## Uzbek traditional names

| name | traditional form | source | note |
|---|---|---|---|
| Merkuriy | Utorid (Atorid) | uzwiki "Merkuriy yoki Utorid (Atorid)" | arxivuz spells "Utorud"; we use Utorid |
| Venera | Zuhra | arxivuz "Venera (oʻzbekcha nomi Zuhra)"; uzwiki gives "Zuhro" | both spellings exist; Zuhra used, as requested |
| Mars | Mirrix | uzwiki "Mars yoki Mirrix" | |
| Yupiter | Mushtariy | uzwiki "Yupiter yoki Mushtariy" | |
| Saturn | Zuhal | uzwiki "Saturn yoki Zuhal" | |
| Uran, Neptun, Pluton | none found | | omitted (discovered 1781 and later) |

## Facts

| slug | claim | value | source |
|---|---|---|---|
| solar-system | age of the oldest solids | 4.567 billion years | Connelly2012 |
| solar-system | Sun's share of Solar System mass | 99.8 % | NASA-sun |
| solar-system | planets / IAU dwarf planets | 8 / 5 (Ceres, Pluto, Haumea, Makemake, Eris) | NASA-dwarf |
| solar-system | Neptune mean distance | 4,514.953 million km = 30.18 au | NSSDC-neptune |
| solar-system | light time Sun→Neptune | 4.2 h (derived: 4,514.953e6 km / c) | NSSDC-neptune |
| solar-system | planet moons known (Sep 2026) | 456 = 0+0+1+2+115+293+29+16 (derived sum) | NSSDC-T (inner), NASA-moons-J/S/U/N |
| solar-system | main Kuiper belt zone | 39.4–47.8 au | Pitjeva2018 |
| solar-system | Kuiper belt total mass | (1.97 ± 0.30) × 10⁻² Earth masses | Pitjeva2018 |
| solar-system | Voyager 1 crossed heliopause | 25 Aug 2012, 121.6 au from Sun | NASA-V1; Horizons (r on 2012-08-25) |
| solar-system | Oort cloud | theorised, not observed; inner edge 2,000–5,000 au, outer 10,000–100,000 au | NASA-oort |
| solar-system | Voyager 1 to Oort cloud | ~300 years to enter, ~30,000 to exit | NASA-oort |
| sun | mean radius | 695,700 km (109 × Earth) | IAU-2015-B3; NSSDC-sun |
| sun | mass | 1.9884 × 10³⁰ kg (332,900 × Earth) | NSSDC-sun |
| sun | luminosity | 3.828 × 10²⁶ W | IAU-2015-B3; NSSDC-sun (382.8 × 10²⁴ J/s) |
| sun | effective temperature | 5,772 K | IAU-2015-B3; NSSDC-sun |
| sun | central temperature (model) | 1.571 × 10⁷ K (≈15.7 million K) | NSSDC-sun |
| sun | corona | up to ~2 million °C | NASA-sun |
| sun | rotation at 16° latitude | 609.12 h = 25.4 days | NSSDC-sun |
| sun | mass converted to energy | 4.26 million tonnes per second (4,260 × 10⁶ kg/s) | NSSDC-sun |
| sun | composition (photosphere, by number) | H 91.0 %, He 8.9 % | NSSDC-sun |
| sun | sunspot cycle | 11.4 yr (NSSDC); ~11 yr (NASA) | NSSDC-sun; NASA-sun |
| sun | light travel time 1 au | 499.0 s = 8 min 19 s (derived: au / c) | IAU-AU |
| sun | solar irradiance at Earth | 1,361 W/m² | NSSDC-earth |
| sun | luminosity check | 1,361 W/m² × 4π(1 au)² = 3.83 × 10²⁶ W (derived) | NSSDC-earth, IAU-AU |
| sun | age, future | ~4.6 billion yr; ~5 billion yr more, red giant then white dwarf | NASA-sun |
| sun | orbit around the Galaxy | ~230 million years | NASA-sun |
| sun | spectral type | G2 V | NSSDC-sun |
| mercury | mean radius | 2,439.7 km | NSSDC-mercury |
| mercury | mass | 0.330 × 10²⁴ kg (0.0553 Earth) | NSSDC-mercury |
| mercury | mean distance | 57.9 million km (0.387 au) | NSSDC-mercury |
| mercury | orbital period | 87.97 days | NSSDC-mercury |
| mercury | sidereal rotation | 1,407.6 h = 58.6 days | NSSDC-mercury |
| mercury | solar day | 4,222.6 h = 176 days | NSSDC-mercury; NASA-mercury |
| mercury | 3 spins per 2 orbits | 3 × 58.65 d = 175.9 d = 2 × 87.97 d (derived) | NSSDC-mercury |
| mercury | temperatures | day up to 430 °C, night down to −180 °C | NASA-mercury |
| mercury | mean temperature | 167 °C | NSSDC-T |
| mercury | eccentricity | 0.206; perihelion 46.0, aphelion 69.8 million km | NSSDC-mercury |
| mercury | moons | 0 | NSSDC-mercury |
| mercury | core | radius ~2,074 km, ~85 % of planet radius | NASA-mercury |
| mercury | polar ice | water ice likely in permanently shadowed polar craters | NASA-mercury |
| mercury | density | 5,429 kg/m³ | NSSDC-T |
| venus | mean radius | 6,051.8 km | NSSDC-venus |
| venus | mass | 4.867 × 10²⁴ kg (0.815 Earth) | NSSDC-venus |
| venus | mean distance | 108.2 million km (0.723 au) | NSSDC-venus |
| venus | orbital period | 224.7 days | NSSDC-venus |
| venus | sidereal rotation | −5,832.6 h = 243 days, retrograde | NSSDC-venus |
| venus | solar day | 2,802 h = 116.75 days | NSSDC-venus |
| venus | surface temperature | 464 °C (737 K) | NSSDC-venus; NSSDC-T |
| venus | surface pressure | 92 bar | NSSDC-venus |
| venus | pressure analogy | like > 930 m under water | NASA-venus |
| venus | atmosphere | 96.5 % CO₂, 3.5 % N₂ | NSSDC-venus |
| venus | clouds | sulfuric acid | NASA-venus |
| venus | Bond albedo | 0.77 | NSSDC-venus |
| venus | closest to Earth | 38.2 million km | NSSDC-venus |
| venus | landers | Venera programme 1961–1984; 10 reached the surface; survived 23 min to ~2 h | NASA-venus |
| venus | Magellan radar map | mission ended 1994 | NASA-venus |
| venus | brightness rank | third brightest in sky after Sun and Moon | NASA-venus |
| earth | mean radius | 6,371.0 km | NSSDC-earth |
| earth | mass | 5.9722 × 10²⁴ kg | NSSDC-earth |
| earth | mean distance | 149.598 million km | NSSDC-earth |
| earth | sidereal year | 365.256 days | NSSDC-earth |
| earth | sidereal rotation / solar day | 23.9345 h / 24.0000 h | NSSDC-earth |
| earth | axial tilt | 23.44° | NSSDC-earth |
| earth | mean temperature | 15 °C (288 K) | NSSDC-earth |
| earth | black-body temperature (no greenhouse) | 254 K (−19 °C) | NSSDC-earth |
| earth | mean density | 5,514 kg/m³ (highest of the planets in NSSDC-T) | NSSDC-T |
| earth | atmosphere | 78 % N₂, 21 % O₂ | NASA-earth; NSSDC-earth (78.08 %, 20.95 %) |
| earth | ocean coverage | ~71 % | NASA-earth |
| earth | age | ~4.5 billion years | NASA-earth |
| earth | life | only known inhabited place | NASA-earth |
| earth | moons | 1 | NSSDC-earth |
| moon | mean radius | 1,737.4 km (0.27 Earth) | NSSDC-moon |
| moon | mass | 7.346 × 10²² kg (0.0123 Earth) | NSSDC-moon |
| moon | mean distance (semi-major axis) | 384,400 km | NSSDC-moon |
| moon | distance range | ~357,000–407,000 km | NSSDC-moon |
| moon | sidereal / synodic month | 27.32 / 29.53 days | NSSDC-moon |
| moon | surface gravity | 1.62 m/s² (0.165 Earth) | NSSDC-moon |
| moon | temperature range (equator) | 95–390 K (−178 to +117 °C) | NSSDC-moon |
| moon | recession | 3.8 cm/yr | NSSDC-moon |
| moon | light time | 1.28 s (derived: 384,400 km / c) | NSSDC-moon |
| moon | tidal locking | same face toward Earth | NASA-moon |
| moon | polar ice | ice in permanently shadowed polar regions | NASA-moon |
| moon | origin | likely a Mars-sized body hit early Earth (leading hypothesis) | NASA-moon |
| moon | Apollo landings | 6 (Apollo 11, 12, 14, 15, 16, 17), 1969–1972; ~400 kg samples | NSSDC-apollo |
| moon | moonwalkers | 12 (derived: 6 landings × 2 astronauts in the lunar module) | NSSDC-apollo |
| mars | mean radius | 3,389.5 km (0.53 Earth) | NSSDC-mars |
| mars | mass | 0.642 × 10²⁴ kg (0.107 Earth) | NSSDC-mars |
| mars | mean distance | 227.956 million km (1.524 au) | NSSDC-mars |
| mars | orbital period | 686.98 days = 1.88 Earth years | NSSDC-mars |
| mars | solar day (sol) | 24.6597 h = 24 h 40 min | NSSDC-mars |
| mars | axial tilt | 25.19° | NSSDC-mars |
| mars | mean temperature | −65 °C | NSSDC-T |
| mars | temperature extremes | ~20 °C to ~−153 °C | NASA-mars |
| mars | surface pressure | 6.36 mbar (≈0.6 % of Earth's 1,014 mbar) | NSSDC-mars; NSSDC-earth |
| mars | atmosphere | CO₂ 95.1 %, N₂ 2.59 %, Ar 1.94 % | NSSDC-mars |
| mars | moons | 2, Phobos and Deimos, both found 1877 by A. Hall | NSSDC-mars; JPL-sats |
| mars | distance from Earth | 54.6–401.4 million km | NSSDC-mars |
| mars | topographic range | 30 km | NSSDC-mars |
| mars | synodic period (launch-window spacing) | 779.94 days ≈ 26 months | NSSDC-mars |
| mars | landers measured pressure/temperature | Viking 1 Lander site values | NSSDC-mars |
| mars | Valles Marineris | ~3,870 km long, up to ~600 km wide, ~9.3 km deep | NASA-mars |
| mars | Olympus Mons | giant volcano, base about the size of Arizona | NASA-mars |
| mars | red colour | oxidised (rusted) iron minerals | NASA-mars |
| mars | ancient water | river valleys, deltas, lakebeds, minerals formed in water | NASA-mars |
| mars | rovers | Perseverance and Curiosity active | NASA-mars |
| jupiter | equatorial / mean radius | 71,492 / 69,911 km (11.2 × Earth eq.) | NSSDC-jupiter |
| jupiter | mass | 1,898.13 × 10²⁴ kg (317.8 Earth) | NSSDC-jupiter |
| jupiter | mass vs other planets | 2.47 × all other planets combined (derived from NSSDC sheets) | NSSDC-*; NASA-jupiter ("more than twice") |
| jupiter | mean distance | 778.5 million km (5.20 au) | NSSDC-jupiter |
| jupiter | orbital period | 4,332.59 d = 11.86 yr | NSSDC-jupiter |
| jupiter | day | 9.9259 h = 9 h 56 min | NSSDC-jupiter |
| jupiter | mean temperature (1 bar) | −110 °C | NSSDC-T |
| jupiter | density | 1,326 kg/m³ | NSSDC-jupiter |
| jupiter | moons | 115 recognised by the IAU (page updated 21 Sep 2026) | NASA-moons-J |
| jupiter | Galilean moons | first seen by Galileo in 1610 | NASA-jupiter |
| jupiter | Ganymede | largest moon in the Solar System, bigger than Mercury | NASA-jupiter |
| jupiter | Great Red Spot | twice as wide as Earth; observed > 300 years | NASA-jupiter |
| jupiter | rings | discovered 1979 by Voyager 1 | NASA-jupiter |
| jupiter | magnetic field | 16–54 × Earth's | NASA-jupiter |
| saturn | equatorial / mean radius | 60,268 / 58,232 km | NSSDC-saturn |
| saturn | mass | 568.32 × 10²⁴ kg (95.2 Earth) | NSSDC-saturn |
| saturn | density | 687 kg/m³ (less than water) | NSSDC-saturn; NASA-saturn |
| saturn | mean distance | 1,432 million km (9.57 au) | NSSDC-saturn |
| saturn | orbital period | 10,755.7 d = 29.4 yr | NSSDC-saturn |
| saturn | day | 10.656 h = 10 h 39 min | NSSDC-saturn |
| saturn | mean temperature (1 bar) | −140 °C | NSSDC-T |
| saturn | flattening | 0.098 | NSSDC-saturn |
| saturn | moons | 293 confirmed as of Aug 2026 | NASA-moons-S |
| saturn | rings | extend up to 282,000 km from planet; main rings ~10 m thick; ice and rock | NASA-saturn |
| saturn | winds | up to 500 m/s at the equator | NASA-saturn |
| saturn | polar hexagon | ~30,000 km across | NASA-saturn |
| saturn | Cassini | arrived 2004, ended 15 Sep 2017 | NASA-saturn |
| saturn | Enceladus | water jets, internal ocean | NASA-saturn |
| uranus | equatorial / mean radius | 25,559 / 25,362 km (4.0 × Earth) | NSSDC-uranus |
| uranus | mass | 86.811 × 10²⁴ kg (14.5 Earth) | NSSDC-uranus |
| uranus | mean distance | 2,867 million km (19.17 au) | NSSDC-uranus |
| uranus | orbital period | 30,685.4 d = 84.0 yr | NSSDC-uranus |
| uranus | day | 17.24 h, retrograde | NSSDC-uranus |
| uranus | axial tilt | 97.77° | NSSDC-uranus; NASA-uranus |
| uranus | mean temperature (1 bar) | −195 °C | NSSDC-T |
| uranus | coldest planetary atmosphere | minimum 49 K (−224 °C) | NASA-uranus |
| uranus | seasons | 21-year-long dark winter at each pole | NASA-uranus |
| uranus | discovery | William Herschel, 13 Mar 1781; first planet found with a telescope | NSSDC-uranus; NASA-uranus |
| uranus | moons | 29 as of Aug 2026; named after Shakespeare and Pope characters | NASA-moons-U; NASA-uranus |
| uranus | rings | 13 faint rings | NASA-uranus |
| uranus | visits | only Voyager 2, 1986 | NASA-uranus |
| uranus | brightest naked-eye | max. apparent magnitude 5.38 | NSSDC-uranus |
| neptune | equatorial / mean radius | 24,764 / 24,622 km | NSSDC-neptune |
| neptune | mass | 102.409 × 10²⁴ kg (17.1 Earth) | NSSDC-neptune |
| neptune | mean distance | 4,515 million km (30.18 au) | NSSDC-neptune |
| neptune | orbital period | 60,189 d = 164.8 yr | NSSDC-neptune |
| neptune | day | 16.11 h | NSSDC-neptune |
| neptune | axial tilt | 28.32° | NSSDC-neptune |
| neptune | mean temperature (1 bar) | −200 °C | NSSDC-T |
| neptune | discovery | Galle, 23 Sep 1846, from Le Verrier's prediction | NSSDC-neptune; NASA-neptune |
| neptune | first full orbit since discovery | 2011 | NASA-neptune |
| neptune | Galileo saw it | as a "fixed star", 1612–1613 | NASA-neptune |
| neptune | winds | > 2,000 km/h | NASA-neptune |
| neptune | moons | 16 | NASA-moons-N; NSSDC-neptune |
| neptune | Triton | retrograde orbit (likely captured), −235 °C, geysers > 8 km | NASA-neptune |
| neptune | visits | Voyager 2, summer 1989 | NASA-neptune |
| neptune | Great Dark Spot | seen 1989, later disappeared | NASA-neptune |
| pluto | mean radius | 1,188 km | NSSDC-pluto |
| pluto | mass | 0.01303 × 10²⁴ kg (0.0022 Earth) | NSSDC-pluto |
| pluto | mean distance | 5,906.4 million km (39.5 au, NSSDC-T); semi-major axis 5,869.7 million km (39.24 au) | NSSDC-T; NSSDC-pluto |
| pluto | perihelion / aphelion | 4,435 / 7,304 million km | NSSDC-pluto |
| pluto | Neptune's perihelion (for comparison) | 4,471 million km (so Pluto's perihelion is inside Neptune's orbit) | NSSDC-neptune |
| pluto | orbital period | 90,560 d = 248 yr | NSSDC-pluto |
| pluto | first full orbit since discovery | ~2178 (derived: 1930 + 247.9 yr) | NSSDC-pluto |
| pluto | day | 153.28 h = 6.4 days, retrograde | NSSDC-pluto |
| pluto | inclination / eccentricity | 17.16° / 0.244 | NSSDC-pluto |
| pluto | mean temperature | −225 °C | NSSDC-T |
| pluto | discovery | Clyde Tombaugh, 18 Feb 1930 | NSSDC-pluto |
| pluto | reclassified | dwarf planet, IAU 2006 | NASA-pluto |
| pluto | New Horizons | flyby 14 Jul 2015 | NASA-pluto |
| pluto | moons | 5: Charon, Nix, Hydra, Kerberos, Styx | NASA-pluto |
| pluto | Charon | about half Pluto's size | NASA-pluto |
| pluto | heart plains | frozen nitrogen, no craters | NASA-pluto |
| pluto | mountains | water ice, 2–3 km high | NASA-pluto |
| pluto | size vs Moon | about two-thirds of the Moon's diameter | NASA-pluto |
| asteroid-belt | main-belt definition | 2.0 < a < 3.2 au, q > 1.666 au | JPL-SBDB |
| asteroid-belt | known main-belt asteroids | 1,396,520 (SBDB, 2026-11-13) | JPL-SBDB |
| asteroid-belt | all known asteroids in SBDB | 1,580,494 (2026-11-13) | JPL-SBDB |
| asteroid-belt | estimated > 1 km | 1.1–1.9 million | NASA-asteroids |
| asteroid-belt | total mass | less than the Moon | NASA-asteroids |
| asteroid-belt | Ceres | radius 476 km; 25 % of belt mass; 2.8 au; 4.6 yr; day 9 h; found 1801 by Piazzi; Dawn arrived 2015; may be up to 25 % water | NASA-ceres |
| asteroid-belt | Vesta | ~530 km diameter; Dawn left Vesta 4 Sep 2012 | NASA-asteroids |
| asteroid-belt | DART | hit Dimorphos 26 Sep 2022 | NASA-asteroids |
| sgr-a-star | mass | (4.297 ± 0.012) × 10⁶ M☉ (stat.; ~0.04 × 10⁶ syst.) | GRAVITY2022 |
| sgr-a-star | distance | 8,277 ± 9 pc (stat.; ~30 pc syst.) = ~27,000 ly | GRAVITY2022; ESO2208 |
| sgr-a-star | EHT ring diameter | 51.8 ± 2.3 µas; observed 2017 at 1.3 mm with 8 telescopes | EHT-SgrA-I |
| sgr-a-star | image release | 12 May 2022 | ESO2208 |
| sgr-a-star | size on sky | like a doughnut on the Moon | ESO2208 |
| sgr-a-star | vs M87* | > 1,000 × smaller and less massive | ESO2208 |
| sgr-a-star | gas orbit time | minutes (vs days–weeks for M87*) | ESO2208 |
| sgr-a-star | S2 | period ~16 yr, pericentre 120 au, ~7,650 km/s | GRAVITY2018 |
| sgr-a-star | S2 precession | 12′ per orbit, matches general relativity | GRAVITY2020 |
| sgr-a-star | Schwarzschild radius | 12.7 million km = 0.085 au (derived: 2GM/c²) | GRAVITY2022 mass |
| m87-black-hole | mass | (6.5 ± 0.7) × 10⁹ M☉ | EHT-M87-I |
| m87-black-hole | distance | 16.8 ± 0.8 Mpc = ~55 million ly (NASA: 54 million ly) | EHT-M87-I; NASA-M87 |
| m87-black-hole | ring diameter | 42 ± 3 µas | EHT-M87-I |
| m87-black-hole | observing dates | 5, 6, 10, 11 April 2017; 1.3 mm; 8 stations at 6 sites | EHT-M87-I |
| m87-black-hole | publication | ApJL 875, L1, 10 April 2019 | EHT-M87-I |
| m87-black-hole | Schwarzschild radius | 1.9 × 10¹⁰ km = 128 au (derived) | EHT-M87-I mass |
| m87-black-hole | host galaxy | giant elliptical in Virgo; ~15,000 globular clusters; found by Messier 1781 | NASA-M87; EHT-M87-I |
| m87-black-hole | mass ratio to Sgr A* | ~1,500 (derived: 6.5e9 / 4.297e6) | EHT-M87-I; GRAVITY2022 |
| gaia-bh3 | black hole mass | 32.70 ± 0.82 M☉ | Panuzzo2024 |
| gaia-bh3 | distance | 590.6 ± 5.8 pc = ~1,926 ly (derived) | Panuzzo2024 |
| gaia-bh3 | orbital period | 4,253.1 ± 98.5 d = 11.6 yr | Panuzzo2024 |
| gaia-bh3 | eccentricity | 0.7291 ± 0.0048 | Panuzzo2024 |
| gaia-bh3 | star's orbit semi-major axis | a₁ = 16.17 ± 0.27 au | Panuzzo2024 |
| gaia-bh3 | companion star | 0.76 ± 0.05 M☉, 4.94 R☉, T_eff 5,212 K, [Fe/H] = −2.56 (≈ 1/360 of solar iron, derived 10^−2.56) | Panuzzo2024 |
| gaia-bh3 | constellation | Aquila | Panuzzo2024 |
| gaia-bh3 | Gaia DR3 ID | 4318465066420528000 | Panuzzo2024 |
| gaia-bh3 | record | most massive stellar-origin black hole known in the Galaxy | Panuzzo2024 |
| gaia-bh3 | discovery | while validating DR4 pre-release data; released early (April 2024) | Panuzzo2024 |
| gaia-bh3 | origin | probably ED-2 stream (disrupted globular cluster) | Panuzzo2024 |
| gaia-bh3 | apparent magnitude | G = 11.23 | Panuzzo2024 |
| crab-nebula | supernova | 1054 AD, recorded by Chinese astronomers as a "guest star"; visible in daytime ~a month | NASA-M1; Hester2008 |
| crab-nebula | distance | 2.0 kpc ≈ 6,500 ly | ATNF; NASA-M1 |
| crab-nebula | pulsar period | 33.39 ms (≈30 rotations per second) | ATNF; NASA-M1 |
| crab-nebula | spin-down power | 4.5 × 10³⁸ erg/s = 4.5 × 10³¹ W ≈ 10⁵ L☉ | ATNF; Hester2008 |
| crab-nebula | slowing | P-dot = 4.21 × 10⁻¹³ s/s | ATNF |
| crab-nebula | characteristic age | 1,260 yr (true age 972 yr in 2026) | ATNF |
| crab-nebula | constellation, magnitude | Taurus, 8.4 | NASA-M1 |
| crab-nebula | nebula found | John Bevis, 1731 | NASA-M1 |
| crab-nebula | ejecta | several solar masses in the outer nebula | Hester2008 |
| crab-nebula | wisps | move outward at about half light speed | NASA-M1 |
| proxima-b | star distance | 1.3012 pc = 4.24 ly (Gaia DR3 parallax 768.5 mas via NEA) | NEA |
| proxima-b | star | M5.5 V, ~3,050 K, ~0.1 % of Sun's luminosity, 0.14 R☉, ~12 % M☉, rotation ~83 d | AE2016 |
| proxima-b | discovery | 2016, radial velocities | AE2016 |
| proxima-b | period | 11.186 d (2016); 11.18465 d (NEA default, SM2025) | AE2016; NEA |
| proxima-b | minimum mass | 1.27 (2016), 1.07 ± 0.06 (2022), 1.055 ± 0.055 (2025) Earth masses | NEA; Faria2022; SM2025 |
| proxima-b | semi-major axis | 0.0485 au | Faria2022; NEA |
| proxima-b | temperature | equilibrium temperature in liquid-water range | AE2016 |
| proxima-b | Proxima d | 5.12 d, min. mass 0.26 Earth; candidate 2022, confirmed 2025 | Faria2022; SM2025 |
| proxima-b | Proxima c | ~1,900 d signal, inconclusive | SM2025 |
| proxima-b | travel time at Voyager 1 speed | ~75,000 yr (derived: 4.015 × 10¹³ km / 16.9 km/s) | NEA; Horizons |
| trappist-1 | distance | 12.43 pc = 40.5 ly | NEA |
| trappist-1 | star | 0.0898 M☉ (≈94 Jupiter masses, derived), 0.1192 R☉ (≈1.19 Jupiter radii, derived), 2,566 K, 5.53 × 10⁻⁴ L☉ | Agol2021 |
| trappist-1 | planets | 7, b–h; b,c,d announced 2016, e,f,g,h 2017 | Gillon2017; NEA |
| trappist-1 | periods | 1.51, 2.42, 4.05, 6.10, 9.21, 12.35, 18.77 d | Agol2021 |
| trappist-1 | radii | 1.116, 1.097, 0.788, 0.920, 1.045, 1.129, 0.755 R⊕ | Agol2021 |
| trappist-1 | masses | 1.374, 1.308, 0.388, 0.692, 1.039, 1.321, 0.326 M⊕ | Agol2021 |
| trappist-1 | distances from star | 0.01154–0.06189 au | Agol2021 |
| trappist-1 | stellar flux | b 4.15, c 2.21, d 1.12, e 0.65, f 0.37, g 0.25, h 0.14 × Earth | Agol2021 |
| trappist-1 | composition | one rocky mass–radius relation, ~21 wt % Fe vs 32 % for Earth, or water-enriched | Agol2021 |
| trappist-1 | architecture | near-resonant chain; very coplanar; stable 10 Myr | Gillon2017; Agol2021 |
| trappist-1 | JWST b | dayside emission: little or no atmosphere, no CO₂ detected | Greene2023 |
| trappist-1 | JWST c | dayside 380 ± 31 K; no thick CO₂ atmosphere | Zieba2023 |
| voyager-1 | launch | 5 Sep 1977 | NASA-V1 |
| voyager-1 | Jupiter / Saturn flybys | 5 Mar 1979 / 12 Nov 1980 | NASA-V1 |
| voyager-1 | heliopause | 25 Aug 2012 at 121.6 au | NASA-V1; Horizons |
| voyager-1 | distance from Sun | 172.33 au = 25.78 billion km on 2026-11-13 | Horizons |
| voyager-1 | distance from Earth | 173.05 au = 25.89 billion km on 2026-11-13 | Horizons |
| voyager-1 | one-way light time | 1,439.2 min = 23 h 59 min on 2026-11-13 | Horizons |
| voyager-1 | one light-day from Earth | expected 18 Nov 2026 | NASA-V1 |
| voyager-1 | speed relative to Sun | 16.88 km/s (Horizons); 17.0 km/s (NASA) | Horizons; NASA-V1 |
| voyager-1 | distance gained | ~1.46 million km/day, ~3.6 au/yr (derived) | Horizons |
| voyager-1 | Pale Blue Dot | final mosaic taken from 40 au | NASA-V1 |
| voyager-1 | Golden Record | greetings in 55 languages, 115 images, 90 min music, 35 sounds | NASA-V1 |
| voyager-1 | power | 3 RTGs, ~158 W each at launch; instruments being switched off to save power | NASA-V1 |
| voyager-1 | Oort cloud | ~300 yr to enter | NASA-oort |
| arecibo-message | date | 16 Nov 1974, at the Arecibo upgrade dedication | Cornell1999; NAIC1975 |
| arecibo-message | frequency | 2,380 MHz (wavelength 12.6 cm, derived) | Cornell1999 |
| arecibo-message | bits | 1,679 = 23 × 73 (both prime) | Cornell1999 |
| arecibo-message | modulation | frequency shifted by ~10 Hz | Cornell1999 |
| arecibo-message | duration | ~3 minutes, sent once | Cornell1999 |
| arecibo-message | target | M13, ~300,000 stars, ~25,000 ly (1999 figure) | Cornell1999 |
| arecibo-message | M13 distance (modern) | 7.42 kpc = ~24,200 ly | BV2021 |
| arecibo-message | authors | Frank Drake, Richard Isaacman, Linda May, James C. G. Walker; Carl Sagan and others contributed | Cornell1999 |
| arecibo-message | contents | chemicals of life, DNA formula, crude Solar System diagram, simple human figure, the Arecibo telescope | Cornell1999 |
| arecibo-message | purpose | "strictly a symbolic event, to show that we could do it" | Cornell1999 |
| arecibo-message | distance travelled by Nov 2026 | ~52 ly (derived: 2026.87 − 1974.87) | — |
| arecibo-message | telescope collapse | 1 Dec 2020 | NSF2020 |
| wow-signal | detection | 15 Aug 1977, ~11:16 pm EDT, Big Ear, Ohio State University | Ehman |
| wow-signal | discoverer | Jerry R. Ehman circled "6EQUJ5" and wrote "Wow!" (probably 19 Aug) | Ehman |
| wow-signal | "U" | 30–31 × background noise | Ehman |
| wow-signal | duration | ~72 s (6 samples, 12 s apart; the beam's transit) | Ehman |
| wow-signal | frequency (Ehman) | 1,420.4556 ± 0.005 MHz; H line 1,420.4056 MHz; one 10 kHz channel | Ehman |
| wow-signal | position | Sagittarius; Dec −26°57′ ± 20′ (J2000) | Ehman |
| wow-signal | repeat | never detected again | Ehman; Mendez2024 |
| wow-signal | Ehman's view | origin "still an open question" | Ehman |
| wow-signal | 2024 hypothesis | cold H I cloud brightened by a transient (e.g. magnetar flare): maser-like flare | Mendez2024 |
| wow-signal | 2025 revision | 1,420.726 ± 0.005 MHz, peak > 250 Jy, RA 19h25m02s or 19h27m55s ± 3s, Dec −26°57′ ± 20′ | Mendez2025 |

## Additional facts used while writing

| slug | claim | value | source |
|---|---|---|---|
| solar-system | age method | uranium–lead isotopes of the first solids | Connelly2012 |
| solar-system | Kuiper belt weighed by | fit to spacecraft ranging data in the EPM ephemerides | Pitjeva2018 |
| solar-system | Oort cloud evidence | long-period comets seem to come from all directions | NASA-oort |
| sun | differential rotation | (14.37 − 2.33 sin²L − 1.56 sin⁴L) deg/day | NSSDC-sun |
| sun | life stage | "a little less than halfway through its lifetime" | NASA-sun |
| sun | photosphere | about 5,500 °C | NASA-sun |
| mercury | global magnetic field | yes | NSSDC-T |
| mercury | atmosphere | surface-bounded exosphere, essentially a vacuum | NSSDC-mercury |
| mercury | mean orbital speed | 47.36 km/s, highest of the planets | NSSDC-mercury; NSSDC-T |
| mercury | smallest planet; most eccentric planetary orbit (0.206) | derived | NSSDC-T |
| mercury | long cliffs from cooling and contraction | — | NASA-mercury |
| mercury | magnetosphere model | "MESSENGER Model 2010" | NSSDC-mercury |
| venus | radius | 0.950 × Earth | NSSDC-venus |
| venus | global magnetic field | none | NSSDC-T |
| venus | closest-approaching planet | 38.2 vs Mars 54.6 and Mercury 77.3 million km (derived comparison) | NSSDC-venus, -mars, -mercury |
| venus | Sun rises in the west | derived from retrograde rotation | NSSDC-venus |
| venus | "hot enough to melt lead"; valleys, mountains, thousands of volcanoes | — | NASA-venus |
| earth | largest rocky planet | derived | NSSDC-T |
| earth | sidereal rotation | 23.9345 h = 23 h 56 min | NSSDC-earth |
| earth | CO₂ in dry air | 420 ppm | NSSDC-earth |
| earth | greenhouse warming | ~34 K (derived: 288 K − 254 K) | NSSDC-earth |
| earth | perihelion | 147.10 million km, 3–4 Jan 2026 | Horizons (target 399, centre 500@10) |
| earth | tilt causes seasons; magnetic field, compass, auroras | — | NASA-earth |
| moon | atmosphere mass | ~25,000 kg | NSSDC-moon |
| moon | Apollo 11 / Apollo 17 landings | 20 Jul 1969 / 11 Dec 1972 | NSSDC-apollo |
| moon | sidereal rotation | 655.72 h = 27.32 d (tidal locking) | NSSDC-moon |
| asteroid-belt | asteroids are rocky remnants from the Solar System's formation | — | NASA-asteroids |
| asteroid-belt | width of the main belt | 1.2 au ≈ 180 million km (derived: 3.2 − 2.0 au) | JPL-SBDB |
| jupiter | polar radius | 66,854 km | NSSDC-jupiter |
| jupiter | magnetosphere toward the Sun | 1–3 million km | NASA-jupiter |
| saturn | polar radius | 54,364 km (≈6,000 km less than equatorial) | NSSDC-saturn |
| saturn | known since prehistory | — | NSSDC-saturn |
| uranus | interior | ≥ 80 % of mass a hot dense fluid of water, methane, ammonia over a small rocky core | NASA-uranus |
| uranus | colour | methane absorbs red light | NASA-uranus |
| uranus | other retrograde planet | Venus | NASA-uranus |
| uranus | day measured | Voyager 2 radio science, magnetic coordinates | NSSDC-uranus |
| uranus | density | 1,270 kg/m³ | NSSDC-T |
| uranus | sunlight travel time | ≈2 h 40 min (derived) | NSSDC-uranus |
| uranus | orbits since 1781 | ≈2.9 (derived) | NSSDC-uranus |
| neptune | composition, blue colour from methane | — | NASA-neptune |
| neptune | Voyager 2 images bluer than reality (contrast enhanced) | — | NASA-neptune |
| neptune | Adams also predicted it | — | NSSDC-neptune |
| neptune | Great Dark Spot could contain Earth | — | NASA-neptune |
| neptune | rings | ≥ 5 main rings: Galle, Leverrier, Lassell, Arago, Adams | NASA-neptune |
| neptune | density | 1,638 kg/m³ | NSSDC-neptune |
| pluto | density | 1,854 kg/m³ | NSSDC-pluto |
| pluto | atmosphere | mainly N₂, with CH₄ and CO | NASA-pluto |
| pluto | surface temperature | −226 to −240 °C | NASA-pluto |
| pluto | inclination larger than any planet's | 17.16° vs Mercury 7.0° | NSSDC-T |
| voyager-1 | communications | via NASA's Deep Space Network | NASA-V1 |
| voyager-1 | "family portrait" of six planets; Earth image → "Pale Blue Dot" | — | NASA-V1 |
| voyager-1 | heliopause ≈ 120 × Earth's distance | derived from 121.6 au | — |
| voyager-1 | most distant human-made object | — | NASA-V1 |
| arecibo-message | modulation like computer modems | — | Cornell1999 |
| arecibo-message | sent in the afternoon | — | Cornell1999 |
| arecibo-message | platform mass | 900 tons | NSF2020 |
| sgr-a-star | 2020 Nobel Prize in Physics | half to Genzel and Ghez | https://www.nobelprize.org/prizes/physics/2020/press-release/ |
| sgr-a-star | telescopes | ~3 decades of VLT, Keck, Gemini; GRAVITY since 2016/17, 30–100 µas | GRAVITY2022 |
| sgr-a-star | extended mass inside S2's orbit | ≤ ~0.1 % of the central mass | GRAVITY2020; GRAVITY2022 |
| sgr-a-star | S2 speed / c | > 2.5 % (derived: 7,650 / 299,792) | GRAVITY2018 |
| sgr-a-star | gravitational redshift of S2 detected | 2018 | GRAVITY2018 |
| m87-black-hole | M87* vs Sgr A* distance | ~2,000 × (derived: 16.8 Mpc / 8.277 kpc) | EHT-M87-I; GRAVITY2022 |
| m87-black-hole | ring : centre brightness | ~10 : 1 | EHT-M87-I |
| m87-black-hole | brighter side | relativistic beaming of plasma near light speed | EHT-M87-I |
| m87-black-hole | ring stable over 4 nights, several imaging methods | — | EHT-M87-I |
| m87-black-hole | Moon's apparent diameter | 1,896″ | NSSDC-moon |
| m87-black-hole | horizon diameter vs Voyager 1 | ~256 au > 172 au (derived) | EHT-M87-I; Horizons |
| gaia-bh3 | photocentre semi-major axis | a₀ = 27.39 ± 0.49 mas | Panuzzo2024 |
| gaia-bh3 | main-sequence companion ruled out | luminosity too low by several orders of magnitude | Panuzzo2024 |
| gaia-bh3 | earlier Gaia BHs | BH1 and BH2 from DR3; BH3 the only one > 20 M☉ | Panuzzo2024 |
| gaia-bh3 | halo, not disc | — | Panuzzo2024 |
| gaia-bh3 | star–centre-of-mass distance | ~4.4–28 au (derived: a₁(1 ∓ e)) | Panuzzo2024 |
| gaia-bh3 | UVES and other ground spectra | — | Panuzzo2024 §2.3 |
| gaia-bh3 | Gaia measures > 1 billion stars | 1.8 billion sources in DR3 | Gaia Collab., Vallenari et al. 2023, A&A 674, A1, doi:10.1051/0004-6361/202243940 |
| crab-nebula | surface magnetic field | 3.79 × 10¹² G = 3.8 × 10⁸ T | ATNF (BSURF) |
| crab-nebula | Earth's surface field | 0.24–0.66 G | NSSDC-earth |
| crab-nebula | period growth | ~13 µs per year (derived: P-dot × 1 yr) | ATNF |
| crab-nebula | synchrotron radio–X-ray; Hubble and Chandra | — | Hester2008 |
| crab-nebula | direction | Galactic longitude ≈ 185°, i.e. away from the Galactic centre (from RA/Dec) | atlas catalogue `messier-ngc.json` |
| proxima-b | stellar wobble from b | K = 1.24 m/s | Faria2022 |
| proxima-b | Proxima is moderately active | — | AE2016 |
| proxima-b | b's orbit ≈ 1/8 of Mercury's distance | derived: 0.0485 / 0.387 | AE2016; NSSDC-mercury |
| trappist-1 | mass method | 4 years of Spitzer transit times; 3–5 % precision, equal to 2.5 cm/s RV | Agol2021 |
| trappist-1 | star age | 7.6 ± 2.2 Gyr (Burgasser & Mamajek, as cited) | Agol2021 |
| trappist-1 | Mars's share of Earth's sunlight | 0.43 (586.2 / 1,361 W/m²) | NSSDC-mars |
| wow-signal | Big Ear watched the strip ~60 days; two horns | — | Ehman |
| wow-signal | look-alike signals ~100 × weaker in 2020 Arecibo data | — | Mendez2024 |
| wow-signal | archival data source | Ohio SETI project | Mendez2025 |

## Uzbek constellation and star names used

| Uzbek | Latin | source |
|---|---|---|
| Qavs | Sagittarius | https://uz.wikipedia.org/wiki/Qavs_(Zodiak_yulduz_turkumi) |
| Sunbula | Virgo | https://uz.wikipedia.org/wiki/Sunbula |
| Burgut | Aquila | https://uz.wikipedia.org/wiki/Burgut_(yulduzlar_turkumi) |
| Savr | Taurus | https://uz.wikipedia.org/wiki/Savr |
| Gerkules | Hercules | https://uz.wikipedia.org/wiki/Gerkules_(yulduz_turkumi) |
| Proksima Sentavr | Proxima Centauri | https://uz.wikipedia.org/wiki/Alfa_Sentavr |

## Re-check log

Twelve facts were drawn at random (`random.seed(20261113)`, 12 rows of the Facts table) and their sources
re-opened on 2026-11-13 with a fresh HTTP fetch. All twelve matched.

| claim | source re-opened | passage found |
|---|---|---|
| Mars mean temperature −65 °C | NSSDC-T | "Mean Temperature (C) 167 464 15 -20 -65 …" |
| Oort cloud distance | NASA-oort | "occupies space at a distance between 5,000 and 100,000 astronomical units" (intro; the page's scale section gives inner 2,000–5,000 au, outer 10,000–100,000 au) |
| Earth air 78 % N₂, 21 % O₂ | NASA-earth | "78% nitrogen, 21% oxygen, and 1% other gases" |
| Earth ocean 71 % | NASA-earth | "covers about 71% of the planet's surface" |
| Vesta ~530 km | NASA-asteroids | "Vesta – the largest asteroid at about 329 miles (530 kilometers) in diameter" |
| Neptune semi-major axis 4,514.953 million km | NSSDC-neptune | "Semimajor axis (10⁶ km) 4,514.953" |
| Proxima b in liquid-water range | AE2016 (arXiv:1609.03449) | "equilibrium temperature in the range where water could be liquid on its surface" |
| Mercury 3:2 spin–orbit (inputs) | NSSDC-mercury | "Sidereal orbit period (days) 87.969"; "Sidereal rotation period (hrs) 1407.6" |
| Arecibo message 16 Nov 1974 | Cornell1999 | "…16, 1974, and contained some very basic information about the human race" |
| Venus surface pressure 92 bar | NSSDC-venus | "Surface pressure: 92 bars" |
| Sun age ~4.6 billion years | NASA-sun | "…when the solar system was first forming, about 4.6 billion years ago" |
| M87* ring 42 ± 3 µas | EHT-M87-I (arXiv:1906.11238) | "an asymmetric bright emission ring with a diameter of 42+/-3 micro-as" |

Also re-checked while editing: NASA-V1 "Voyager 1 became the most distant human-made object" (17 Feb 1998);
NASA-asteroids "rocky remnants left over from the formation of our solar system"; NASA-mercury core
"about 85% of the planet's radius"; NASA-oort "why they seem to come from all directions".

## Known limits

- Moon counts change often. The NSSDC table (Mar 2025) lists Jupiter 95, Saturn 274, Uranus 28; the
  articles use NASA's moon pages of Sep 2026 (115, 293, 29, 16) and say "as of 2026".
- The NAIC 1975 Icarus paper is paywalled and was not read; the Arecibo message facts come from the
  Cornell 1999 release, with the paper cited as the original description.
- Hester 2008 was read only as its abstract (paywalled); the articles use it only for the 1054 origin,
  the ~10⁵ L☉ spin-down power, the several solar masses of ejecta and the radio–X-ray synchrotron glow.
- NASA's Voyager 1 page is internally inconsistent on how many instruments still work (two vs four);
  the articles give no count.
- Pluto: the NSSDC table's "distance from Sun" (5,906.4 million km) and the sheet's semi-major axis
  (5,869.7 million km) differ; the articles use the semi-major axis.
- Deep links use `#focus=<catalogue name>` as requested. The viewer's hash parser
  (`web/src/state/hash.ts`) does not handle `focus` yet, and `Voyager 1`, `Arecibo message`,
  `Wow! signal`, `Sgr A*`, `Gaia BH3`, `TRAPPIST-1` and the Solar System bodies still need catalogue
  entries with those names.
