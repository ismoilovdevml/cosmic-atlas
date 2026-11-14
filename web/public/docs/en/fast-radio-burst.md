---
title: Fast radio burst
summary: A flash of radio waves lasting about a millisecond, from another galaxy. Some repeat; most have been seen only once.
related: [neutron-star, pulsar, galaxy, redshift, neutrino]
sources:
  - Lorimer et al. 2007, Science 318, 777, A Bright Millisecond Radio Burst of Extragalactic Origin (arXiv:0709.4301)
  - Spitler et al. 2016, Nature 531, 202, A repeating fast radio burst (arXiv:1603.00581)
  - Chatterjee et al. 2017, Nature 541, 58, A direct localization of a fast radio burst and its host (arXiv:1701.01098)
  - Macquart et al. 2020, Nature 581, 391, A census of baryons in the Universe from localized fast radio bursts (arXiv:2005.13161)
  - CHIME/FRB Collaboration 2020, Nature 587, 54, A bright millisecond-duration radio burst from a Galactic magnetar (arXiv:2005.10324)
  - Kirsten et al. 2022, Nature 602, 585, A repeating fast radio burst source in a globular cluster (arXiv:2105.11445)
  - Ryder et al. 2023, Science 382, 294, A luminous fast radio burst that probes the Universe at redshift 1 (arXiv:2210.04680)
  - CHIME/FRB Collaboration 2026, The Second CHIME/FRB Catalog, arXiv:2601.09399 (release 20251231)
  - FRBs/FRB repository (BSD-3-Clause), public_hosts.csv and FRBs_base.csv, https://github.com/FRBs/FRB
  - Cosmic Atlas, scripts/build_frb.py and data/tiles/catalogs/provenance/frb.json (counts)
updated: 2026-11-14
---

## What is it?

A **fast radio burst** (FRB) is a single, very bright flash of radio waves that lasts about a
thousandth of a second. In that instant it can give off as much energy as the Sun does in days. Nearly
all FRBs come from other galaxies, hundreds of millions to billions of light-years away.

Most FRBs have been seen only once. A few dozen **repeat**, flashing again at irregular intervals. What
makes them is still debated, but the leading idea is a **magnetar**: a young
[neutron star](doc:neutron-star) with an extreme magnetic field.

## How do we know?

The first FRB was found in 2007 by Duncan Lorimer and his student David Narkevic, hidden in 2001
archive data from the Parkes radio telescope. Its signal was smeared in a telling way: the lower radio
frequencies arrived later than the higher ones. Radio waves are slowed by free electrons in space, and
the delay grows with the number of electrons along the way. That number is the **dispersion measure**
(DM, in pc cm⁻³). Far more electrons lay along the path than our own Galaxy holds, so the burst had to
come from far outside it.

In 2016 FRB 20121102A was found to repeat, which let radio arrays pin it down in 2017 to a small dwarf
galaxy at [redshift](doc:redshift) 0.19. Since then astronomers have matched about a hundred FRBs to
their host galaxies and measured the hosts' redshifts. Those FRBs showed that DM grows with distance.
The electrons they count are the "missing" ordinary matter spread thinly between the galaxies.

In April 2020 a known magnetar in our own Galaxy, SGR 1935+2154, gave off a millisecond radio burst
nearly as bright as a weak FRB. It was the first link between FRBs and magnetars.

The Canadian **CHIME** telescope, with no moving parts, sees a large part of the northern sky every day
and finds new FRBs almost daily. Its second catalogue lists 4,539 bursts from 3,641 sources, including
83 repeaters.

## Surprising but true

- The closest known FRB, [FRB 20200120E](#focus=FRB%2020200120E), repeats from an old globular cluster
  of the galaxy M81, 3.5 Mpc away: not the place one would expect a young magnetar.
- The farthest one with a host, [FRB 20220610A](#focus=FRB%2020220610A), is at redshift 1.016: its
  flash travelled for about 8 billion years.
- An FRB lasts about as long as a camera flash, yet it is detected across billions of light-years.

## Where to find it in this atlas

The [fast radio burst layer](#layer=frb) shows FRBs as pink rings, in two ways:

- **101 FRBs with a host-galaxy redshift** sit in 3D, at the distance of their host (Planck 2018
  cosmology). Zoom out to a few Gpc to see them spread through the [cosmic web](doc:cosmic-web), or fly
  to [FRB 20121102A](#focus=FRB%2020121102A), the first one tied to a galaxy.
- **3,661 other FRBs** (3,579 from CHIME, 82 localised ones without a host redshift) are only
  **directions** on the sky, drawn at infinity like the sky background and only near the Sun. Their DM
  hints at a distance, but the conversion depends on a model, so the atlas does not invent one.
  Repeaters have bigger rings. Most lie in the northern sky, which CHIME sees.

Click a ring: the card gives its DM, fluence (brightness × duration, in Jy ms), whether it repeats and,
for the 3D ones, the host galaxy.
