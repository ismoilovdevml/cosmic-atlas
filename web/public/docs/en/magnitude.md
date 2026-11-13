---
title: Magnitude
summary: Astronomers' brightness scale. Smaller numbers mean brighter; 5 magnitudes is a factor of exactly 100 in brightness.
related: [star, units, gaia-mission, desi-survey]
sources:
  - Las Cumbres Observatory, What is apparent magnitude?, https://lco.global/spacebook/distance/what-apparent-magnitude/
  - Las Cumbres Observatory, Comparing magnitudes, https://lco.global/spacebook/distance/comparing-magnitudes-different-objects/
  - NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
  - Gaia DR3 overview (G ≈ 3 to 21), https://www.cosmos.esa.int/web/gaia/dr3
  - Mamajek et al. 2015, IAU 2015 Resolution B2, arXiv:1510.06262
  - Cosmic Atlas catalogue named-stars.json (V magnitudes from SIMBAD)
updated: 2026-11-13
---

## What is it?

A **magnitude** is a number for how bright something looks. The scale is old and a bit upside down:
the *smaller* the number, the *brighter* the object. Very bright objects even get negative numbers.

The idea goes back to the Greek astronomer Hipparchus. He called the brightest stars "first magnitude"
and the faintest stars he could see "sixth magnitude". He did not include the Sun, the Moon or the
planets.

Much later the astronomer Norman Pogson made the scale exact: a difference of 5 magnitudes is a
factor of exactly 100 in brightness. So one magnitude is a factor of the fifth root of 100, about **2.512**. A 1st-magnitude star
is 100 times brighter than a 6th-magnitude star.

## How is it measured?

Telescopes collect light with a camera and count how much arrives through a filter. The result is
compared with reference stars. Because each filter lets through different colours, a magnitude always
belongs to a band: V (visual, green-yellow), Gaia's broad G band, or DESI's r band (red), for example.

Two kinds of magnitude matter:

- **Apparent magnitude (m):** how bright the object looks from Earth.
- **Absolute magnitude (M):** how bright it would look from a standard distance of 10 parsecs. This
  compares true power. The Sun's apparent visual magnitude is −26.74, but its absolute magnitude is
  only +4.83: from 10 pc it would be a faint naked-eye star.

If you know both m and M, you can work out the distance, and the other way round. This difference,
m − M, is called the *distance modulus*.

## Surprising but true

| Object | Apparent magnitude |
|---|---|
| Sun | −26.7 |
| Full Moon | −12.6 |
| Sirius, the brightest night-time star | −1.46 |
| Vega | 0.03 |
| Naked-eye limit, dark sky | about +6 |
| Naked-eye limit, city | about +3 |
| Faintest objects seen by Hubble | about +30 |

- From +6 to +30 is 24 magnitudes: a factor of about 4 billion in brightness.
- Gaia measured stars from about G = 3 down to G = 21. Stars brighter than that, such as Sirius,
  saturate its detectors, so this atlas takes them from the older Hipparcos catalogue.

## Where to find it in this atlas

Click a [Gaia star](#layer=stars-gaia): the info card shows its apparent G magnitude and its colour
(BP − RP, blue minus red). DESI galaxies show their apparent r magnitude. Named stars such as
[Sirius](#focus=Sirius) or [Vega](#focus=Vega) show their V magnitude.

The atlas also uses magnitudes to draw. It computes how bright each point would look from where the
camera is now, so stars brighten as you fly towards them. The **Exposure** slider in the Layers panel
shifts this in magnitudes, like a camera's exposure. The "brightness code M" on a star's card is a
drawing aid, not a science-grade absolute magnitude: it ignores dust.
