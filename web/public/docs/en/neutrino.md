---
title: High-energy neutrinos
summary: Ghostly particles that cross the universe in straight lines. IceCube catches a few from cosmic accelerators such as the blazar TXS 0506+056.
related: [black-hole, quasar, galaxy, fast-radio-burst, x-ray-sky]
sources:
  - IceCube Collaboration 2013, Science 342, 1242856, Evidence for High-Energy Extraterrestrial Neutrinos at the IceCube Detector (arXiv:1311.5238)
  - IceCube Collaboration et al. 2018, Science 361, eaat1378, Multimessenger observations of a flaring blazar coincident with high-energy neutrino IceCube-170922A (arXiv:1807.08816)
  - IceCube Collaboration 2018, Science 361, 147, Neutrino emission from the direction of the blazar TXS 0506+056 prior to the IceCube-170922A alert (arXiv:1807.08794)
  - Paiano et al. 2018, ApJL 854, L32, The redshift of the BL Lac object TXS 0506+056 (arXiv:1802.01939)
  - IceCube Collaboration 2022, Science 378, 538, Evidence for neutrino emission from the nearby active galaxy NGC 1068 (arXiv:2211.09972)
  - Abbasi et al. 2023, ApJS 269, 25, IceCat-1, the IceCube Event Catalog of Alert Tracks (CC0; doi:10.7910/DVN/SCRUCD)
  - KM3NeT Collaboration 2025, Nature 638, 376, Observation of an ultra-high-energy cosmic neutrino with KM3NeT; energy as quoted in arXiv:2502.08173, direction and 90 % radius as quoted in arXiv:2509.25422
  - IceCube Neutrino Observatory, detector description, https://icecube.wisc.edu/science/icecube/
  - Cosmic Atlas, scripts/build_neutrinos.py and data/tiles/catalogs/provenance/neutrino.json; positions checked against SIMBAD (Harvard mirror) and NED
updated: 2026-11-14
---

## What is it?

A **neutrino** is a tiny particle with no electric charge and almost no mass. It hardly ever touches
anything: billions of neutrinos from the Sun pass through your fingertip every second, and almost all
of them go straight through the Earth as well.

That shyness makes neutrinos special messengers. Light can be blocked by dust or bent away; charged
cosmic rays are steered by magnetic fields, so they do not point back to where they came from. A
neutrino travels in a straight line from its source. **High-energy** neutrinos, millions of times more
energetic than those from the Sun, are made where protons are accelerated to extreme energies and smash
into gas or light: near [black holes](doc:black-hole) in active galaxies, perhaps in exploding stars.

## How do we know?

To catch something that barely interacts you need a huge, transparent detector. **IceCube** is a cubic
kilometre of clear Antarctic ice under the South Pole, watched by 5,160 light sensors on 86 strings
between 1,450 and 2,450 m deep. When a neutrino does hit an atom, it makes a fast charged particle that
leaves a faint blue trail of light. From the sensors' timing, IceCube rebuilds the direction.

In 2013 IceCube reported the first high-energy neutrinos from beyond the Solar System. Since 2016 it
sends out alerts within minutes when it sees a likely cosmic one. The IceCat-1 catalogue collects 348 of
these alert tracks from 2011 to 2023. Each comes with a **90 % region**: the direction is uncertain by a
degree or more, so the true source lies somewhere in that box. Each also has a **signalness**, the chance
that it is cosmic rather than made in our own atmosphere.

Two sources have been identified so far:

- **TXS 0506+056**, a blazar: a galaxy whose black hole shoots a jet almost straight at us. On
  22 September 2017 the neutrino IceCube-170922A arrived from its direction while it was flaring in
  gamma rays; a chance match is unlikely at the 3σ level. Old data then showed a burst of 13 ± 5
  neutrinos from it in 2014–15 (3.5σ). It lies at redshift 0.3365, about 1.4 Gpc away; its neutrinos
  travelled for 3.9 billion years.
- **NGC 1068** (M77), a nearby active galaxy 14.4 Mpc away: 79 neutrinos above the background in
  2011–2020 data, a 4.2σ excess (2022). Its black hole is hidden behind thick gas that stops gamma
  rays but lets neutrinos out.

On 13 February 2023 the KM3NeT/ARCA detector in the Mediterranean Sea caught **KM3-230213A**, the most
energetic neutrino ever seen: about 220 PeV (68 % range 110–790 PeV), about ten times the highest
energy IceCube had recorded. Its source is not known.

## Surprising but true

- A high-energy neutrino can cross the whole observable universe without being stopped by anything.
- IceCube is the world's largest neutrino detector, yet IceCat-1 holds only 348 alerts in about twelve
  years: two or three a month.
- NGC 1068 shines brighter in neutrinos than in gamma rays, which tells astronomers the neutrinos come
  from deep inside, close to the black hole.

## Where to find it in this atlas

Turn on the [neutrino layer](#layer=neutrinos). Near the Sun, each IceCat-1 alert is a cyan star with
its 90 % region outlined on the sky, brighter for a higher signalness; KM3-230213A has a 2.2° circle.
These are **directions only**: a neutrino does not tell how far away its source is.

The two identified sources are drawn in 3D with a larger mark:
[TXS 0506+056](#focus=TXS%200506%2B056) at 1.37 Gpc and
[NGC 1068](#focus=NGC%201068%20%28IceCube%20source%29) at 14.4 Mpc. Look at TXS 0506+056 from Earth and
you will see the alert box of IceCube-170922A around it. Click any mark for its energy, signalness,
error region and date.
