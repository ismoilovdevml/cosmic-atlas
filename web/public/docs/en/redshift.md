---
title: Redshift
summary: Light from distant galaxies arrives stretched to longer, redder wavelengths. The stretch, z, tells us how far the light has travelled through expanding space.
related: [lookback-time, desi-survey, quasar, cosmic-web, distance-uncertainty]
sources:
  - Hubble 1929, PNAS 15, 168, A Relation Between Distance and Radial Velocity Among Extra-Galactic Nebulae, https://pmc.ncbi.nlm.nih.gov/articles/PMC522427/
  - Planck Collaboration 2020, A&A 641, A6, Planck 2018 results VI (arXiv:1807.06209); astropy Planck18 used for the distances below
  - DESI Collaboration 2025, Data Release 1, arXiv:2503.14745
  - Kellermann 2013, The Discovery of Quasars and its Aftermath, arXiv:1304.3627
  - Cosmic Atlas, data/raw/galaxies-desi/PROVENANCE.json (redshift histogram of the DESI layer)
updated: 2026-11-13
---

## What is it?

Every chemical element absorbs and emits light at its own fixed set of wavelengths, like a barcode.
When astronomers spread a distant galaxy's light into a spectrum, they recognise the barcode, but it
sits at longer wavelengths than in a laboratory: it is shifted towards the red. This is **redshift**.

It is measured with one number:

**z = (observed wavelength − laboratory wavelength) / laboratory wavelength.**

If z = 1, every wavelength has been stretched to twice its original length.

For nearby objects, a small redshift or blueshift comes from motion towards or away from us (the
Doppler effect). For distant galaxies the main cause is different: space itself has expanded while the
light was travelling, and the light waves were stretched with it. So 1 + z tells you how much the
universe has grown since the light left: at z = 1 it was half its present size.

## How do we know?

In 1929 Edwin Hubble compared the distances of nearby galaxies with the speeds measured from their
spectra and found that the farther a galaxy is, the faster it appears to recede. This relation became key
evidence that the universe is expanding.

Today a redshift is measured from a spectrum. The [DESI](doc:desi-survey) instrument takes 5,000 spectra
at once and has measured redshifts for millions of galaxies and [quasars](doc:quasar). From z and a model
of the expanding universe (this atlas uses the Planck 2018 parameters) we get a distance. Some
examples, from that model:

| Redshift z | Distance today (comoving) | Light left it |
|---|---|---|
| 0.01 | 44 Mpc | 0.14 billion years ago |
| 0.1 | 433 Mpc | 1.3 billion years ago |
| 0.5 | 1.95 Gpc | 5.2 billion years ago |
| 1 | 3.40 Gpc | 7.9 billion years ago |
| 2 | 5.31 Gpc | 10.5 billion years ago |

## Surprising but true

- The quasar 3C 273 was understood in 1963 when Maarten Schmidt recognised ordinary hydrogen
  lines in its spectrum, shifted by z = 0.158. That redshift meant it was far away and enormously
  luminous.
- Redshift is not only a speed. The light of a z = 1 galaxy was stretched because the universe grew
  while the light was on its way.
- Galaxies also move through space on their own, pulled by their neighbours. For nearby galaxies
  that adds a noticeable error to a redshift distance, which is why the atlas uses other methods below z = 0.003 (see
  [distance uncertainty](doc:distance-uncertainty)).

## Where to find it in this atlas

Click any point in the [DESI](#layer=galaxies-desi) or [2MRS](#layer=galaxies-2mrs) layers: the info
card shows its redshift z, its comoving distance and its [lookback time](doc:lookback-time). Galaxy
colours in the atlas follow redshift too: warm ivory near z = 0, then rose, then violet from
z ≈ 1.5; quasars are drawn pale cyan. Three quarters of the 15.1 million DESI objects in the atlas
have z below 1, only about 6,100 have z of 4 or more, and the farthest quasars reach z ≈ 6.8. The
readout under the scale rail gives the redshift at the centre of the view once you are beyond 10 Mpc.
