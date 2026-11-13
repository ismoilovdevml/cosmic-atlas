---
title: DESI
summary: The Dark Energy Spectroscopic Instrument measures redshifts of millions of galaxies and quasars. Its first data release gives this atlas 15.1 million of them.
related: [redshift, cosmic-web, galaxy, quasar, lookback-time]
sources:
  - DESI Collaboration 2025, Data Release 1 of the Dark Energy Spectroscopic Instrument, arXiv:2503.14745
  - Fermilab press release, 19 March 2025, DESI opens access to the largest 3D map of the universe yet, https://news.fnal.gov/2025/03/desi-opens-access-to-the-largest-3d-map-of-the-universe-yet/
  - DESI home page, https://www.desi.lbl.gov/
  - IFAE news, 15 April 2026, DESI completes planned 3D map of the universe and continues exploring, https://www.ifae.es/news/2026/04/15/desi-completes-planned-3d-map-of-the-universe-and-continues-exploring/
  - Cosmic Atlas, data/raw/galaxies-desi/PROVENANCE.json (query, cuts and counts of the DESI layer)
updated: 2026-11-13
---

## What is it?

DESI, the **Dark Energy Spectroscopic Instrument**, is a machine for measuring the
[redshifts](doc:redshift) of galaxies very quickly. It sits on the Nicholas U. Mayall 4-metre telescope
at Kitt Peak National Observatory in Arizona, USA. Its focal plane holds 5,000 optical fibres, each
moved into place by its own small robot. Every fibre catches the light of one galaxy, quasar or star
and carries it to spectrographs. About every 20 minutes, in clear weather, the robots move and a new
set of 5,000 objects is observed.

Its goal is to understand **dark energy**, the unknown cause of the accelerating expansion of the
universe. By mapping where galaxies are in 3D over billions of years, DESI measures how fast the
universe grew in different eras.

## How does it work?

A spectrum splits light into its colours. Lines from hydrogen, oxygen and other elements show up at
known wavelengths, shifted by the expansion of the universe. Software recognises the pattern and
measures the redshift z, which gives the distance.

DESI's main survey began in May 2021. **Data Release 1 (DR1)**, published on 19 March 2025, covers its
first 13 months (to June 2022) plus an earlier validation period. It holds high-confidence redshifts
for 18.7 million objects: 13.1 million galaxies, 1.6 million quasars and 4 million stars. Its 3D map
reaches galaxies seen as they were about 11 billion years ago, and its most distant quasars lie
farther still.

DESI's four main extragalactic samples reach different depths: the Bright Galaxy Survey (BGS) of
nearby galaxies, luminous red galaxies (LRG), emission-line galaxies (ELG) full of young stars and,
farthest of all, [quasars](doc:quasar).

## Surprising but true

- DR1 contains more than twice as many extragalactic objects as all earlier 3D surveys combined. The
  Sloan Digital Sky Survey collected 9 million unique objects in about 25 years.
- DESI can observe more than 100,000 galaxies in a single night.
- DESI finished its planned five-year survey ahead of schedule in April 2026, with more than 47 million galaxies
  and quasars against an original target of 34 million. Observations continue through 2028.
- DR1 is 270 terabytes and free for anyone to use.

## Where to find it in this atlas

The [DESI](#layer=galaxies-desi) layer contains **15,140,002** DR1 objects: 13,556,136 galaxies and
1,583,866 quasars. Stars were left out, as were redshifts flagged as unreliable, and objects with
z < 0.003, whose redshift distance would be unreliable. Each point sits at its Planck 2018 comoving
distance. Click a point to see its redshift, distance range and [lookback time](doc:lookback-time), and
follow the link to the Legacy Surveys viewer to see the galaxy's image.

To see the [cosmic web](doc:cosmic-web), fly out to about 1 Gpc and turn on **Thin slab** in the Layers
panel. DESI covers only part of the sky, so from far away it looks like a fan or wedge with empty sides.
