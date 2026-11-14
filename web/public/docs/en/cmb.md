---
title: Cosmic microwave background
summary: The oldest light in the universe, released 380,000 years after the Big Bang. Planck mapped its tiny temperature ripples across the whole sky.
related: [redshift, lookback-time, cosmic-web, galaxy, units]
sources:
  - Penzias & Wilson 1965, ApJ 142, 419, A Measurement of Excess Antenna Temperature at 4080 Mc/s
  - Fixsen 2009, ApJ 707, 916, The Temperature of the Cosmic Microwave Background (arXiv:0911.1955)
  - Planck Collaboration 2020, A&A 641, A1, Planck 2018 results I, overview (arXiv:1807.06205)
  - Planck Collaboration 2020, A&A 641, A4, Planck 2018 results IV, diffuse component separation (SMICA map; arXiv:1807.06208)
  - Planck Collaboration 2020, A&A 641, A6, Planck 2018 results VI, cosmological parameters (z* = 1089.92; arXiv:1807.06209)
  - Planck Legacy Archive maps via IRSA, COM_CMB_IQU-smica_2048_R3.00_full.fits, https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/
  - Cosmic Atlas, scripts/build_cmb.py and web/public/sky/planck_smica_cmb.json (distance, age and map statistics computed with astropy Planck18)
updated: 2026-11-14
---

## What is it?

The **cosmic microwave background** (CMB) is light left over from the young universe. For its first
few hundred thousand years the universe was a hot, glowing fog of charged particles, and light could
not travel far before it bounced off a free electron. When the gas cooled to about 3,000 K, electrons
and protons joined into neutral hydrogen and the fog cleared. The light released at that moment has
been travelling ever since.

That moment is called **last scattering**. It happened at a [redshift](doc:redshift) of about 1,090,
when the universe was 1,090 times smaller than today and about 380,000 years old (372,000 years in the
Planck 2018 cosmology the atlas uses). Since then the expansion has stretched the light from a
yellow-white glow into microwaves. Today it is a nearly perfect glow at **2.7255 K**, coming from
every direction.

## How do we know?

In 1964–65 Arno Penzias and Robert Wilson found a faint microwave hiss in a radio antenna at Bell Labs
that came equally from every direction and would not go away. It was this background; they shared the
1978 Nobel Prize in Physics for it. Satellites then measured it far better. COBE showed that its
spectrum is an almost perfect black body, and the best value of its temperature is
2.72548 ± 0.00057 K.

The CMB is not perfectly smooth. Its temperature differs from place to place by about one part in
100,000. In the Planck map these ripples have a typical size (rms) of **107 µK**, millionths of a
degree. They are the seeds of everything that came later: slightly denser regions grew, under gravity,
into the galaxies and the [cosmic web](doc:cosmic-web). ESA's Planck satellite (2009–2013) mapped the
ripples over the whole sky, and from their pattern astronomers measure the age, the content and the
expansion rate of the universe.

The map in this atlas is Planck's SMICA map (2018 release). The Milky Way glows brightly in
microwaves too, so Planck removed it by combining nine frequency channels. Along a thin strip of the
Galactic plane (1.5 % of the sky) the CMB cannot be recovered, and Planck filled it with a
statistically matching pattern; you are looking at that fill there, not at a measurement. Our own
motion through space makes one half of the sky about 3.4 mK warmer than the other (the dipole); that
large effect is removed, as in every CMB map. Red is warmer and blue cooler than average, from
−300 to +300 µK.

## Surprising but true

- The CMB is the farthest thing we can see with light. The gas that emitted it is now about
  **13.9 Gpc** (45 billion light-years) away, in comoving terms, although its light set out only
  13.8 billion years ago: space kept expanding while the light was on its way
  ([lookback time](doc:lookback-time)).
- Every cubic centimetre of space holds about 410 CMB photons (computed from its 2.7255 K temperature).
- When it was released, the light was about 2,970 K (2.7255 K × 1,091): a glow roughly the colour of a
  household light bulb.

## Where to find it in this atlas

Turn on the [CMB layer](#layer=cmb) and zoom all the way out. Once you have flown past the
[cosmic web](doc:cosmic-web), beyond about 8 Gpc, the **last scattering surface** appears: a sphere
around us at the comoving distance of redshift 1,090, 13,884 Mpc in the Planck 2018 cosmology. It is
always drawn behind everything else. From outside, at the 30 Gpc zoom limit, you see its far inner
wall through the open front, which is the CMB sky as seen from Earth, and a faint outline of the
near wall. Click its label, or go to [the CMB](#focus=CMB), for the card with its numbers.

This sphere is centred on us because every observer has their own: it is simply as far as light can
have reached us from. Galaxies far beyond it exist, we just cannot see them with light.
