---
title: Artificial satellite
summary: A spacecraft circling the Earth. Almost 17,000 working ones are tracked; most fly a few hundred km up and go round in about an hour and a half.
related: [earth, moon, spacecraft, solar-system]
sources:
  - CelesTrak, GP data, group "active" (snapshot 2026-11-14 06:40 UTC), https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json
  - CelesTrak usage policy (updated 2026-11-12), https://celestrak.org/usage-policy.php
  - Vallado, Crawford, Hujsak and Kelso 2006, Revisiting Spacetrack Report #3, AIAA 2006-6753, https://celestrak.org/publications/AIAA/2006-6753/
  - JPL Horizons, James Webb Space Telescope (-170), https://ssd.jpl.nasa.gov/horizons/
  - NASA Science, Hubble Space Telescope, https://science.nasa.gov/mission/hubble/
updated: 2026-11-14
---

## What is it?

An artificial satellite is a spacecraft placed in orbit around the Earth. It does not fall back
because it moves sideways fast enough: in a low orbit about 7.7 km every second, so that the ground
curves away beneath it as quickly as it falls. Satellites relay phone calls and television, measure
the weather, guide navigation, watch the Earth and look out into space.

## Key numbers

| | Working satellites in the CelesTrak "active" list, 14 November 2026 |
|---|---|
| All of them | 16,896 |
| Starlink | 11,191 |
| Lowest point below 2,000 km (low Earth orbit) | 16,108 |
| Near the geostationary height (35,000–36,500 km) | 584 |
| International Space Station | about 416 km up, one orbit in 92.9 minutes |

The station figures are what this atlas computes for 14 November 2026 from the station's element set.

## How do we know where they are?

The United States Space Force tracks objects in orbit with radar and telescopes and publishes their
orbits as compact sets of numbers ("general perturbations" elements). CelesTrak redistributes them.
A model called SGP4 turns such a set into a position at any time. The set ages: the further the time
from the set's epoch, the larger the error, mainly because air drag in low orbit changes from day to
day. For the ISS we measured 0.2 to 1.2 km against CelesTrak's operator-based supplemental data
within a day of the epoch, and 8 km after three days.

## Surprising but true

- Two out of three working satellites (66 %) belong to one network, Starlink.
- The geostationary satellites at about 36,000 km go round once in 23 h 56 min, the time the Earth takes to turn once, so each one seems to
  hang still over one point of the equator. In this atlas they make a thin ring around the Earth.
- The James Webb Space Telescope is not in orbit around the Earth at all: it circles a point in space
  about 1.5 million km beyond the Earth, on the side away from the Sun, and keeps pace with the Earth
  around the Sun.

## Where to find it in this atlas

Turn on [Earth satellites](#layer=satellites) and fly to the [Earth](#focus=Earth). The points
appear within about 0.03 AU of the Earth: the dense shell of low orbits, the ring of geostationary
satellites and, further out, [JWST](#focus=JWST). Labels mark the [ISS](#focus=ISS), the Chinese
station [Tiangong](#focus=Tiangong) and [Hubble](#focus=Hubble). Click any point to see its orbit
numbers and how old its element set is. The probes that are leaving the Solar System are described in
[Spacecraft](doc:spacecraft).
