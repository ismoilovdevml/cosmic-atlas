---
title: Star cluster
summary: Stars born together from one cloud. Open clusters are young and loose; globular clusters are ancient, dense balls of up to millions of stars.
related: [star, milky-way, nebula, gaia-mission, interstellar-message]
sources:
  - Hunt & Reffert 2023, A&A 673, A114, Improving the open cluster census II (arXiv:2303.13424)
  - Hunt & Reffert 2024, A&A 686, A42, Improving the open cluster census III, cluster masses and bound/unbound classes (arXiv:2403.05143)
  - Baumgardt & Hilker 2018, MNRAS 478, 1520, masses and structural parameters of Milky Way globular clusters (Baumgardt globular cluster database, 4th version)
  - Baumgardt & Vasiliev 2021, MNRAS 505, 5957, Accurate distances to Galactic globular clusters (arXiv:2105.09526)
  - NASA Science, Hubble Messier catalog, Messier 45, https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-45/
  - NASA Science, Star clusters: inside the universe's stellar collections, https://science.nasa.gov/universe/star-clusters-inside-the-universes-stellar-collections/
  - National Geographic, 40 years ago, Earth beamed its first postcard to the stars, https://www.nationalgeographic.com/science/article/40-years-ago-earth-beamed-its-first-postcard-to-the-stars
  - Cosmic Atlas catalogue messier-ngc.json (OpenNGC, SIMBAD, Hunt & Reffert 2023, Baumgardt & Vasiliev 2021)
  - Cosmic Atlas catalogue clusters.json and the star-clusters layer (scripts/build_clusters.py)
updated: 2026-11-14
---

## What is it?

Stars are rarely born alone. A big cloud of gas and dust collapses into many stars at once, and for a
while they stay together as a **star cluster**. All stars in a cluster have about the same age, the same
distance and the same starting chemistry, which makes clusters natural laboratories for studying how
stars live.

There are two main kinds:

- **Open clusters** are loose groups of tens to thousands of stars in the disc of the
  [Milky Way](doc:milky-way). They are young, typically less than a billion years old, and loosely
  bound, so their stars tend to drift apart. The Pleiades is a famous example.
- **Globular clusters** are dense, round swarms of tens of thousands to millions of stars, found
  throughout the halo around the Galaxy. Their stars formed roughly 8 to 13 billion years ago, among
  the oldest stars known. The Milky Way has about 150 known globular clusters.

## How do we know?

To find a cluster, you look for stars that sit close together in space *and* move together across the
sky. That is exactly what [Gaia](doc:gaia-mission) measures. In 2023 Emily Hunt and Sabine Reffert
searched 729 million Gaia DR3 stars with a clustering algorithm and found **7,167 clusters**, including
2,387 candidate new ones and 134 globular clusters. Their stricter list contains 4,105 highly reliable
clusters. They also found that some clusters in older catalogues may not be real.

In 2024 the same authors weighed every cluster and asked a simple question: is its own gravity
strong enough to hold it together? Only **5,647** passed and count as bound open clusters. **1,309**
are *moving groups*: their stars travel together but are drifting apart. Close to the Sun most groups
are of this kind; within 250 pc only about one in nine is a bound cluster.

Globular clusters are too far for simple parallaxes to be precise, so Holger Baumgardt and Eugene
Vasiliev (2021) combined Gaia, Hubble and other data to measure distances to 162 globular clusters,
about 20 of them to 1 % or better.

## Surprising but true

- The Pleiades, or "Seven Sisters", contains more than a thousand stars. NASA notes its distance, about
  445 light-years, is "not universally agreed upon". The atlas uses 134.8 pc (440 light-years) from Hunt
  & Reffert.
- Hunt & Reffert's member lists often include "tidal tails": stars escaping from the cluster and
  stretching away from it.
- In 1974 the Arecibo radio telescope sent humanity's first deliberate message to the stars towards the
  globular cluster M13 (see [interstellar message](doc:interstellar-message)).

## Where to find it in this atlas

The [star clusters layer](#layer=star-clusters) shows all **7,181** clusters as points: the Hunt &
Reffert census (without 17 objects they later rejected as galaxies or errors) and the 167 globular
clusters of Baumgardt's database. Brighter points are heavier clusters, bluer ones younger; this is a
display choice, not a measured colour. About 6,000 of them, every bound open cluster, every globular,
every Messier/NGC cluster and the moving groups within 250 pc, also have a label and an info card with
age, number of member stars, the radius that holds half of them and mass. Globular clusters keep the
Baumgardt & Vasiliev distances, which are more precise there than Gaia parallaxes alone. The ages
come from fitting the colours of the member stars and can be off by a factor of two (see the range
on the card). Try:

- [Hyades, Melotte 25](#focus=Melotte%2025), the nearest open cluster at 47 pc, about 580 million years old;
- [Pleiades, M45](#focus=M45), an open cluster at 135 pc, about 120 million years old;
- [Beehive, M44](#focus=M44), an open cluster at 183 pc;
- [the Double Cluster h and χ Persei, NGC 869](#focus=NGC%20869) and [NGC 884](#focus=NGC%20884),
  two young clusters (about 18 million years) side by side at 2.3 kpc;
- [Hercules cluster, M13](#focus=M13), a globular cluster at 7.42 kpc;
- [Omega Centauri, NGC 5139](#focus=NGC%205139), a globular cluster at 5.43 kpc;
- [47 Tucanae, NGC 104](#focus=NGC%20104), a globular cluster at 4.52 kpc.

Around the Pleiades, look at the [Gaia stars](#layer=stars-gaia): its members stand out as a tight
group of stars at the same distance. Some young clusters are still wrapped in the gas they formed from, as in the
[Orion Nebula](#focus=M42) (see [nebula](doc:nebula)).
