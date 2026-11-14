---
title: Gravitational waves
summary: Ripples in space itself, sent out when black holes or neutron stars merge. Detectors on Earth have caught hundreds of them since 2015.
related: [black-hole, neutron-star, redshift, distance-uncertainty, galaxy]
sources:
  - LIGO Scientific Collaboration & Virgo Collaboration 2016, PRL 116, 061102, Observation of gravitational waves from a binary black hole merger (arXiv:1602.03837)
  - LIGO Scientific Collaboration & Virgo Collaboration 2017, PRL 119, 161101, GW170817 (arXiv:1710.05832)
  - LIGO, Virgo, Fermi GBM & INTEGRAL 2017, ApJL 848, L13, Gravitational waves and gamma-rays from a binary neutron star merger (arXiv:1710.05834)
  - Coulter et al. 2017, Science 358, 1556, Swope Supernova Survey 2017a (SSS17a), the optical counterpart to GW170817 (arXiv:1710.05452)
  - Cantiello et al. 2018, ApJL 854, L31, A precise distance to the host galaxy of GW170817 (arXiv:1801.06080)
  - Singer et al. 2016, ApJL 829, L15, Going the distance (3D sky maps, arXiv:1603.07333)
  - GWOSC, Gravitational Wave Open Science Center, cumulative GWTC event list, https://gwosc.org/eventapi/html/GWTC/ (CC BY 4.0, read 2026-11-14)
  - LVK sky-map data releases on Zenodo, GWTC-2.1 (record 6513631), GWTC-3 (8177023), GWTC-4.1 (20275769), GWTC-5.0 (20348005)
  - Cosmic Atlas catalogue gw-events.json (scripts/build_gw.py)
updated: 2026-11-14
---

## What is it?

Mass bends space and time. When two very heavy, very compact objects, such as
[black holes](doc:black-hole) or [neutron stars](doc:neutron-star), orbit each other closely and
merge, they shake space itself. The shaking spreads out at the speed of light as **gravitational
waves**. Einstein predicted them in 1916.

By the time the waves reach Earth they are unimaginably weak: they stretch and squeeze a 4 km
detector arm by far less than the width of a proton. Two LIGO detectors in the USA, Virgo in Italy
and KAGRA in Japan measure this with laser light bouncing between mirrors.

## How do we know?

On 14 September 2015 both LIGO detectors recorded the same short "chirp", **GW150914**: two black
holes of about 35 and 30 solar masses merging into one of about 62. Three solar masses vanished
into gravitational-wave energy in a fraction of a second.

The signal itself tells us a lot:

- **Masses**, from how fast the chirp rises in pitch.
- **Distance**, from how loud the signal is. This is a *luminosity distance*, so the atlas converts
  it to the comoving distance it uses everywhere (see [redshift](doc:redshift)).
- **Direction**, only roughly, from the tiny time differences between detectors. With two or three
  detectors the source can lie anywhere in a patch of tens to thousands of square degrees.

Put direction and distance together and you get a **3D region**, not a point. The LIGO, Virgo and
KAGRA teams publish it as a sky map with a distance estimate for every patch of sky.

## Surprising but true

- **GW170817** (17 August 2017) was two neutron stars. 1.7 seconds after the merger, the Fermi
  satellite saw a burst of gamma rays from the same part of the sky. About 11 hours later telescopes
  found a new light in the galaxy **NGC 4993**: a *kilonova*, glowing debris rich in heavy elements
  such as gold. It is still the only event with a known home galaxy.
- The 90 % region of GW170817 is about **220 Mpc³**. A typical event in the catalogue has one of about
  **10⁹ Mpc³**, a volume that holds many thousands of galaxies. That is why most events have no host.
- The loudest event in the catalogue, [GW250114_082203](#focus=GW250114_082203) (signal-to-noise ratio
  78.6), was two black holes of about 34 and 32 solar masses, much like the very first one.

## Where to find it in this atlas

The atlas shows the **282 events** with measured masses and distances in the GWOSC catalogue list
(GWTC-1 to GWTC-5.0). Each is drawn as a soft, translucent volume: the region that holds the
source with 90 % probability, fitted with a few ellipsoids from the LVK sky map. **The label is not
the source**: it marks the centre of the largest part of the volume. The info card gives the volume
in Mpc³. Blue volumes are two black holes, teal a neutron star and a black hole, gold two neutron
stars.

- Turn on the [gravitational-wave localisations](#layer=gw-volumes) and look from 4 Gpc.
- [GW170817](#focus=GW170817) sits exactly in its host galaxy [NGC 4993](#focus=NGC%204993), at the
  galaxy's distance of 40.7 Mpc (surface-brightness fluctuations, Cantiello et al. 2018).
- [GW150914](#focus=GW150914), the first detection, about 430 Mpc away (comoving).
- [GW190814](#focus=GW190814), a black hole with a partner of 2.6 solar masses, one of the best
  localised events (about 36,000 Mpc³).

The masses on the cards are *source-frame* masses with 90 % ranges, straight from GWOSC. The 90 %
volumes were recomputed here from the public sky maps and agree with the LVK's own numbers to
better than 1 % where those are published (GWTC-2.1).
