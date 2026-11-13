---
title: Quasar
summary: The brilliant core of a distant galaxy, powered by gas falling into a supermassive black hole. Quasars outshine whole galaxies and are seen across the universe.
related: [black-hole, galaxy, redshift, lookback-time, desi-survey]
sources:
  - Kellermann 2013, The Discovery of Quasars and its Aftermath, arXiv:1304.3627
  - Wang et al. 2021, ApJL 907, L1, A Luminous Quasar at Redshift 7.642 (arXiv:2101.03179)
  - Event Horizon Telescope Collaboration 2019, ApJL 875, L1, First M87 EHT results I (arXiv:1906.11238)
  - DESI Collaboration 2025, Data Release 1, arXiv:2503.14745
  - Cosmic Atlas, data/raw/galaxies-desi/PROVENANCE.json (quasar count and redshift range)
  - Planck Collaboration 2020, A&A 641, A6 (arXiv:1807.06209); lookback times computed with astropy Planck18
updated: 2026-11-13
---

## What is it?

A **quasar** is the extremely bright centre of a galaxy. At its heart sits a supermassive
[black hole](doc:black-hole), millions to billions of times the mass of the Sun. Gas swirling towards
the black hole forms a hot disc that glows more brightly than all the stars of the galaxy around it.

The name comes from "quasi-stellar radio source": in early photographs quasars looked like faint
stars, yet some were strong radio sources. Today we know they are among the most luminous objects in
the universe, and because they are so bright we can see them across billions of light-years.

## How do we know?

In 1962 the strong radio source 3C 273 passed behind the Moon several times. Watching exactly when its
radio signal disappeared and reappeared, astronomers in Australia pinned down its position, which
matched a 13th-magnitude "star". Maarten Schmidt took its spectrum with the 200-inch Palomar
telescope and in 1963 realised that its strange lines were ordinary hydrogen lines, shifted by a
[redshift](doc:redshift) of 0.158. At that distance, the "star" had to be far more powerful than a
whole galaxy.

Since then, spectra have been the key. A quasar's spectrum shows bright emission lines from hot gas
near the black hole. Surveys such as [DESI](doc:desi-survey) recognise
quasars automatically from these lines and measure their redshifts.

The black holes behind quasars are real. In 2019 the Event Horizon Telescope imaged the shadow of the
6.5-billion-solar-mass black hole in the galaxy M87, which its team called powerful evidence that
supermassive black holes are the central engines of active galactic nuclei, the family quasars belong to.

## Surprising but true

- 3C 273 had been photographed as early as 1887, long before anyone knew what it was.
- The quasar J0313−1806, at redshift 7.64, is seen as it was about 670 million years after the Big
  Bang. Its black hole already weighed 1.6 billion Suns, and the quasar shines with about
  36 trillion times the Sun's luminosity. How such black holes grew so fast is still an open question.
- For decades after 1963, not every astronomer accepted that quasars were really so far away and so
  powerful. The evidence from redshifts kept growing until the view became general.

## Where to find it in this atlas

The [DESI](#layer=galaxies-desi) layer contains 1,583,866 quasars with confident redshifts. They are
drawn in pale cyan, while galaxies are drawn from ivory to violet by redshift. Fly out to 1 Gpc or more
to see them: in this layer every object beyond z = 2 is a quasar (the farthest galaxies stop near
z = 1.7), and the farthest quasars reach z ≈ 6.8, whose light left about 13 billion years ago.

Click a cyan point: the info card lists it in the DESI layer with its redshift, comoving distance and
[lookback time](doc:lookback-time). Compare the black hole in [M87](#focus=M87) and our own quiet one,
[Sgr A*](#focus=Sgr%20A*) ([article](doc:sgr-a-star)).
