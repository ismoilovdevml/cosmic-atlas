---
title: Gaia
summary: ESA's Gaia spacecraft measured positions, distances and motions of nearly two billion stars from 2014 to 2025. Its data are the star layer of this atlas.
related: [parallax, star, white-dwarf, distance-uncertainty, milky-way]
sources:
  - ESA, Gaia overview, https://www.esa.int/Science_Exploration/Space_Science/Gaia
  - ESA, Gaia fact sheet, https://sci.esa.int/web/gaia/47354-fact-sheet
  - ESA, Gaia DR3 overview, https://www.cosmos.esa.int/web/gaia/dr3
  - ESA, Farewell Gaia! Spacecraft operations come to an end, https://www.esa.int/Enabling_Support/Operations/Farewell_Gaia!_Spacecraft_operations_come_to_an_end
  - Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1, Gaia DR3 summary (doi:10.1051/0004-6361/202243940)
  - Bailer-Jones et al. 2021, AJ 161, 147 (doi:10.3847/1538-3881/abd806)
  - Gaia Collaboration, Panuzzo et al. 2024, A&A 686, L2, Gaia BH3 (arXiv:2404.10486)
updated: 2026-11-13
---

## What is it?

Gaia is a space telescope of the European Space Agency (ESA) built to make the most precise 3D map of
our Galaxy ever. It was launched on 19 December 2013 and worked about 1.5 million km from Earth, on
the far side from the Sun, near a point called L2. It slowly spun around, sweeping two telescopes
across the whole sky again and again. Their light fell on one shared focal plane of 106 CCD detectors,
about a billion pixels in total.

Gaia did not take pretty pictures. It measured, very precisely, where each star is, how bright it is,
what colour it is, and how its position changes over the years.

## How does it work?

Because Gaia saw each star many times over several years, it could separate three motions:

- the star's yearly wobble caused by the Earth's orbit, its [parallax](doc:parallax), which gives the
  distance;
- its steady drift across the sky (its *proper motion*);
- for a smaller set, its speed towards or away from us, from a spectrum.

Gaia's third data release, **Gaia DR3** (13 June 2022), is built from 34 months of observations
(July 2014 to May 2017). It contains 1,811,709,771 sources. Of these, 1,467,744,818 have a parallax
and proper motion, and 33,812,183 have a measured radial velocity. For bright stars the typical
parallax error is only 0.02–0.03 milliarcseconds, about the size of a large coin (4–5 cm) on the Moon
as seen from Earth.

Science observations ended on 15 January 2025, when Gaia was running out of the cold gas it used to
keep itself pointed precisely. On 27 March 2025 the team switched it off and sent it into a
retirement orbit around the Sun. The work goes on on the ground: **Gaia DR4**, based on 66 months of data, is expected in December 2026,
and the final release is planned for no earlier than the end of 2030.

## Surprising but true

- Over the mission Gaia made more than three trillion observations.
- Its data revealed hidden black holes. In 2024, in data being prepared for DR4, the Gaia team found
  [Gaia BH3](doc:gaia-bh3), a black hole of 32.7 solar masses only 590 pc away, the heaviest
  black hole of stellar origin known in our Galaxy when it was announced.
- Gaia also tracked hundreds of thousands of asteroids and mapped millions of galaxies and quasars.
- About 1,500 team members' names were written into the spacecraft's memory before it was switched off.

## Where to find it in this atlas

The [Gaia stars](#layer=stars-gaia) layer holds Gaia DR3 stars within 1 kpc (about 3,260 light-years)
of the Sun. Only stars with a parallax at least 10 times its error and a good astrometric fit
(RUWE < 1.4) are included, and their distances are the Bailer-Jones et al. (2021) geometric distances.
Click any star to see its Gaia DR3 ID, magnitude, colour and distance range, with a link to its Gaia
record.

Beyond 1 kpc, the background is the **Gaia all-sky image**, made from the light of all of Gaia's stars.
Stars that are too bright for Gaia, like [Sirius](#focus=Sirius), come from the older Hipparcos
catalogue. White dwarfs found in Gaia data have their own article: [white dwarf](doc:white-dwarf).
