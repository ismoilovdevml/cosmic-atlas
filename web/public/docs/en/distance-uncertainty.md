---
title: Distance uncertainty
summary: No distance in astronomy is exact. The atlas shows each point's likely range, as a 16–84 % interval, a 3D error bar and an optional stretched view.
related: [parallax, redshift, gaia-mission, desi-survey, how-to-use]
sources:
  - Bailer-Jones et al. 2021, AJ 161, 147, Estimating distances from parallaxes V (doi:10.3847/1538-3881/abd806, arXiv:2012.05220)
  - Gaia DR3 overview (parallax precision), https://www.cosmos.esa.int/web/gaia/dr3
  - DESI Collaboration 2025, Data Release 1, arXiv:2503.14745
  - Huchra et al. 2012, ApJS 199, 26, 2MASS Redshift Survey (doi:10.1088/0067-0049/199/2/26)
  - Tully et al. 2023, ApJ 944, 94, Cosmicflows-4 (doi:10.3847/1538-4357/ac94d8)
  - Tully et al. 2014, The Laniakea supercluster of galaxies, arXiv:1409.0880 (peculiar velocities)
  - Cosmic Atlas, docs/data-contract.md, web/README.md, data/raw/*/PROVENANCE.json
updated: 2026-11-13
---

## What is it?

Every measured distance comes with an error. A star might be "about 300 parsecs away", but the honest
answer is "most likely between 290 and 310 parsecs". Maps of the sky usually hide this and draw each
star as a sharp dot. This atlas tries to show it.

For each point we keep three numbers: the best estimate (the median) and the **16th and 84th
percentiles**. In plain words: there is roughly a 68 % chance that the true distance lies between the
two, the same width as "plus or minus one standard deviation" for a bell curve.

## How is it measured?

**Stars (Gaia).** A star's distance comes from its [parallax](doc:parallax). If the parallax error is
10 % of the parallax, the distance error is roughly 10 % too, and it grows quickly for fainter, farther
stars. Bailer-Jones and colleagues (2021) turned the parallaxes of 1.47 billion Gaia stars into
distances with a probability method: each parallax is combined with a model of where stars are likely
to be in our Galaxy. They publish a median and the 16th and 84th percentiles. The range is often
lopsided (asymmetric), so the two sides can differ. To keep the map sharp, this
atlas only shows stars whose parallax is at least 10 times its error.

**Galaxies (DESI, 2MRS).** Here the distance comes from [redshift](doc:redshift). DESI measures
redshifts very precisely, so the pure measurement error is small. A bigger problem is that galaxies
also move through space on their own, pulled by the gravity of their neighbours. This "peculiar
motion" adds an extra Doppler shift on top of the expansion, and for nearby galaxies, where the
expansion effect is still small, it can spoil a redshift distance. That is why the atlas does not use
redshift distances below z = 0.003 (about 13 Mpc) and takes measured distances instead, for example
from [Cosmicflows-4](#layer=galaxies-cf4).

**Nearby galaxies.** Distances to Local Group and Local Volume galaxies are collected from many
different methods, each with its own error.

The DESI range shown on the info card comes from the redshift measurement error alone. It does not
include the peculiar motions described above, so for nearby galaxies the true uncertainty is larger.

## Surprising but true

- A 10 % distance error means a 20 % error in an object's true brightness, because brightness falls
  with the square of distance.
- A faint star (G = 20) at 1 kpc has a parallax of 1 milliarcsecond, but Gaia DR3's typical error at
  that magnitude is 0.5 milliarcsecond: a 50 % error. Such stars do not pass the atlas's quality cut.
- For bright stars Gaia DR3 reaches 0.02–0.03 milliarcsecond, so a bright star 1 kpc away has a
  distance error of only about 2–3 %.

## Where to find it in this atlas

- **Info card:** click a star or galaxy. Under the distance you see the "16–84 % range" and the
  fractional error, such as ±3 %. If a lower bound is the only thing known, it says "no upper bound".
- **Error bar:** the selected object gets a line along the line of sight from the 16 % to the 84 %
  distance, drawn in 3D. A dashed line means there is no upper bound.
- **Distance uncertainty display:** open the Layers panel and tick *Distance uncertainty*. Points in the
  most important parts of the view (up to 32 tiles at a time) are stretched into short streaks
  along the line of sight, each as long as its distance range. Look at the [Gaia stars](#layer=stars-gaia) from far away: the streaks all point
  at the Sun, because that is where the measurement was made.
