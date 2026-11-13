---
title: Lookback time
summary: Light takes time to travel, so we see distant objects as they were long ago. Lookback time is how long ago that light set off.
related: [redshift, units, desi-survey, quasar, cosmic-web]
sources:
  - Planck Collaboration 2020, A&A 641, A6, Planck 2018 results VI (arXiv:1807.06209); values below computed with astropy Planck18
  - NASA Science, Universe overview (CMB about 380,000 years after the Big Bang), https://science.nasa.gov/universe/overview/
  - Wang et al. 2021, A Luminous Quasar at Redshift 7.642, arXiv:2101.03179
  - NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
  - Cosmic Atlas source code, web/src/math/units.ts and web/src/math/cosmology.ts
updated: 2026-11-13
---

## What is it?

Light is the fastest thing there is, but it is not instant. It needs about 8 minutes to come from the
Sun, 4.2 years from the nearest star and about 2.6 million years from the Andromeda Galaxy. Whenever you
look out into space, you look back in time.

**Lookback time** is how long ago the light we receive today left its source. For nearby objects it is
simply the distance in light-years: light from a star 100 light-years away left 100 years ago.

For distant galaxies it is more subtle, because the universe expanded while the light travelled. The
galaxy is now much farther away than the distance the light covered. So astronomers keep two numbers
apart: the **lookback time** (how long the light was on its way) and the **comoving distance** (how far
away the galaxy is today, if the expansion could be paused).

## How do we know?

For a distant galaxy we measure its [redshift](doc:redshift) z. A model of the expanding universe then
turns z into a lookback time. This atlas uses the Planck 2018 model, which gives the universe an age of
13.79 billion years. Some values:

| Redshift z | Lookback time | Age of the universe then | Distance today |
|---|---|---|---|
| 0.1 | 1.3 billion years | 12.4 billion years | 0.43 Gpc |
| 1 | 7.9 billion years | 5.9 billion years | 3.40 Gpc |
| 3 | 11.6 billion years | 2.1 billion years | 6.50 Gpc |
| 6.8 | 13.0 billion years | 0.79 billion years | 8.74 Gpc |

Notice the last row: light that has been travelling for 13 billion years comes from a place that is
now 8.74 Gpc away, about 28.5 billion light-years. There is no contradiction; space has been stretching
all the while.

## Surprising but true

- The oldest light we can see is the cosmic microwave background. It was released about 380,000 years
  after the Big Bang, when the universe first became transparent.
- The quasar J0313−1806 (z = 7.64, reported in 2021) is seen as it was only about 670 million years
  after the Big Bang. Its black hole already had 1.6 billion times the mass of the Sun.
- Every "picture" of the deep universe mixes ages. In one view of the atlas, nearby galaxies are seen as
  they were a few hundred million years ago and the farthest as they were 13 billion years ago.

## Where to find it in this atlas

Look at the readout below the scale rail. Within 10 Mpc it says how many years ago light left the
point you are looking at (simple distance divided by the speed of light). Beyond 10 Mpc it switches to
the Planck 2018 calculation and also shows the redshift. When you click a galaxy, the info card gives
its "Lookback" time.

Try the [Scale tour](doc:how-to-use): its last stop, the cosmic web, tells you how long ago light left
the far side of the [DESI](#layer=galaxies-desi) map. Then compare the
[Andromeda Galaxy](#focus=M31) (about 2.6 million years) with the far DESI quasars (about 13 billion).
