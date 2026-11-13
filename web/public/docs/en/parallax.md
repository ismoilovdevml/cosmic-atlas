---
title: Parallax
summary: The small yearly shift of a nearby star against distant ones. Measuring that angle gives the star's distance by pure geometry.
related: [units, gaia-mission, distance-uncertainty, star]
sources:
  - Reid & Menten 2020, The First Stellar Parallaxes Revisited, arXiv:2009.11913
  - Gaia DR3 overview (precision, numbers), https://www.cosmos.esa.int/web/gaia/dr3
  - Gaia DR3 parallax of Proxima Centauri, 768.0665 ± 0.0499 mas, VizieR I/355/gaiadr3
  - Bailer-Jones et al. 2021, AJ 161, 147 (doi:10.3847/1538-3881/abd806)
  - Mamajek et al. 2015, IAU 2015 Resolution B2, arXiv:1510.06262
  - Cosmic Atlas, scripts/fetch_gaia.py (cut parallax_over_error > 10, RUWE < 1.4)
updated: 2026-11-13
---

## What is it?

Hold up a finger and look at it with one eye, then with the other. The finger jumps against the
background. That jump is **parallax**, and your brain uses it to judge distance.

Astronomers do the same with the whole orbit of the Earth. In January and in July the Earth is on
opposite sides of the Sun, about 300 million km apart. A nearby star seen from these two places
shifts slightly against much more distant stars. Half of the yearly shift is called the parallax
angle *p*. The smaller the angle, the farther the star.

The rule is simple: **distance in parsecs = 1 / parallax in arcseconds.** A star with a parallax of
0.1 arcsecond is 10 parsecs away. That is why the [parsec](doc:units) exists: it is the distance of a
star with a parallax of one arcsecond.

## How is it measured?

The angles are tiny. Even the nearest star, Proxima Centauri, moves by less than one arcsecond: its
Gaia parallax is 768.07 milliarcseconds (thousandths of an arcsecond), which means 1.30 pc. Most
stars have parallaxes thousands of times smaller.

The first stellar parallaxes were measured in the 1830s. Friedrich Bessel announced the parallax of the
star 61 Cygni in 1838, and Thomas Henderson (Alpha Centauri) and Friedrich von Struve (Vega) published
theirs around the same time. Before that, nobody knew how far the stars were.

Today the champion is the European Space Agency's [Gaia](doc:gaia-mission) satellite. Gaia DR3 gives
parallaxes for 1,467,744,818 sources. For bright stars (G < 15) the typical uncertainty is only
0.02–0.03 milliarcseconds; at G = 20 it is about 0.5 milliarcseconds.

Every measurement has an error, and for faint or very distant stars the error can be as big as the
parallax itself. Then "1 / parallax" gives nonsense. Bailer-Jones and colleagues (2021) solved this
with statistics: they combined each parallax with a model of our Galaxy and published a best distance
plus a range for 1.47 billion stars. See [distance uncertainty](doc:distance-uncertainty).

## Surprising but true

- Von Struve first announced a parallax for Vega of 0.125 arcsecond and later, with more data, doubled
  it. A 2020 re-analysis of his data showed why: the two directions he measured disagreed, and
  only by luck did they combine into the right answer.
- Parallax works only for the Milky Way's nearer parts. For other galaxies the angles are far too
  small, so astronomers use other methods, such as [redshift](doc:redshift).
- Because the Sun also moves through the Galaxy, Gaia measures each star's motion across the sky at the
  same time as its parallax.

## Where to find it in this atlas

The [Gaia stars](#layer=stars-gaia) layer contains only stars whose parallax is at least 10 times
larger than its error (and with a good astrometric fit, RUWE < 1.4), out to 1 kpc. Their distances
are the Bailer-Jones geometric distances. Click any star: the info card shows its median distance and
its 16–84 % range, and a line in 3D shows that range along the line of sight.

Compare a nearby star, [Barnard's Star](#focus=Barnard%27s%20Star) (1.83 pc, Gaia), with a bright
far one such as [Deneb](#focus=Deneb), whose catalogue distance (433 pc) comes from the older
Hipparcos satellite: Gaia cannot measure stars that bright.
