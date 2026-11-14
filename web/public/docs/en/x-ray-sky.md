---
title: The X-ray sky
summary: Seen in X-rays, the sky shows gas at millions of degrees, exploded stars and clusters of galaxies. eROSITA mapped half of it in 2019–2020.
related: [supernova-remnant, neutron-star, black-hole, galaxy, cmb]
sources:
  - Giacconi, Gursky, Paolini & Rossi 1962, Phys. Rev. Lett. 9, 439, Evidence for X Rays From Sources Outside the Solar System
  - Nobel Prize in Physics 2002, Riccardo Giacconi, https://www.nobelprize.org/prizes/physics/2002/summary/
  - Predehl et al. 2021, A&A 647, A1, The eROSITA X-ray telescope on SRG (arXiv:2010.03477)
  - Merloni et al. 2024, A&A 682, A34, The SRG/eROSITA all-sky survey, first data release of the western Galactic hemisphere (arXiv:2401.17274)
  - eROSITA-DE DR1 HiPS (eRASS1 RGB rate, 0.2–0.5 / 0.5–1.0 / 1.0–2.0 keV), https://erosita.mpe.mpg.de/erodat/static/hips/eRASS1_RGB_Rate_c010/ and the acknowledgement page https://erosita.mpe.mpg.de/dr1/AllSkySurveyData_dr1/acknowledgement.html
  - Planck Collaboration 2020, A&A 641, A3, Planck 2018 results III, HFI data processing and frequency maps (arXiv:1807.06207); 857 GHz HiPS from ESA ESDC, https://skies.esac.esa.int/pla/
  - Green 2025, JApA 46, 14 (Catalogue of Galactic SNRs; Vela SNR 255′ across) and Ranasinghe & Leahy 2023, ApJS 265, 53 (Vela SNR 250 pc, 220–280 pc), via the atlas catalogue nebulae-snr.json
  - Cosmic Atlas, scripts/build_sky_backgrounds.py and web/public/sky/sky_backgrounds.json
updated: 2026-11-14
---

## What is it?

X-rays are light with about a thousand times more energy than visible light. On Earth we use them to
see through skin. In space they come from matter that is extremely hot or violent: gas at millions of
degrees inside clusters of galaxies, the expanding shells of [exploded stars](doc:supernova-remnant),
gas spiralling into [black holes](doc:black-hole) and [neutron stars](doc:neutron-star).

Our atmosphere absorbs X-rays completely, which protects life but also means that X-ray astronomy must
be done from rockets and satellites.

## How do we know?

In 1962 Riccardo Giacconi's team flew X-ray counters on a rocket above the atmosphere and found the
first X-ray source beyond the Sun, now called Scorpius X-1, and a faint glow from the whole sky.
Giacconi shared the 2002 Nobel Prize in Physics for founding X-ray astronomy.

**eROSITA** is an X-ray telescope with seven mirror modules aboard the Russian-German satellite SRG,
launched in 2019. From December 2019 it scanned the whole sky every six months. The German consortium
released the first scan of its half of the sky (Galactic longitude 180° to 360°) in January 2024:
nearly 930,000 X-ray sources, over 60 % more than were known before.

In the atlas's eROSITA image, red is soft X-rays (0.2–0.5 keV), green medium (0.5–1 keV) and blue the
hardest band (1–2 keV). Soft red and green light comes mostly from hot gas near the Sun; blue light
passes through more gas, so the dark band along the Milky Way is where dust and gas swallow the softer
X-rays.

## Surprising but true

- The bright yellow blob in the southern sky is the [Vela supernova remnant](#focus=Vela%20SNR), the
  debris of an exploded star only about 250 pc away (220–280 pc). It is over four degrees across, eight
  full Moons side by side.
- Most faint dots in the eROSITA image are not stars but distant galaxies with active black holes, and
  clusters of galaxies full of hot gas.
- The eastern half of the image is black because those data belong to the Russian half of the
  survey, which is not public. Nothing is missing from the sky itself.

## Where to find it in this atlas

Open the [sky background](#layer=gaia-sky) row in the layers panel and pick **eROSITA X-rays** in
its menu. The background is the sky as seen from near the Sun, so look around from close to home
(within about 2 kpc). Try the direction of Vela and Puppis in the southern sky, and compare with the
**Gaia** visible-light image and the **Planck 857 GHz** image, which shows the cold dust that blocks
visible light. All three images are credited in the panel's credits.
