---
title: How to use the atlas
summary: Drag to turn, scroll or pinch to zoom, click a point for its card. Search, layers, the scale rail, the tour and shareable links explained.
related: [index, units, distance-uncertainty, gaia-mission, desi-survey]
sources:
  - Cosmic Atlas source code, web/index.html, web/src/main.ts, web/src/nav/controller.ts, web/src/ui/rail.ts, web/src/tour/tours.ts, web/src/state/hash.ts
  - Cosmic Atlas, web/README.md (controls, search, deep links, tours, distance uncertainty)
  - Cosmic Atlas, docs/content-contract.md (languages, docs panel)
updated: 2026-11-13
---

## Moving around

The atlas is one continuous 3D scene, from the Sun out to billions of parsecs. The camera always looks
at a **focus point** and you move around it.

| Action | Mouse | Touch | Keyboard |
|---|---|---|---|
| Turn around the focus | drag | drag with one finger | arrow keys |
| Slide sideways (pan) | right-drag or Shift-drag | move two fingers | |
| Zoom towards the cursor | scroll wheel | pinch | + and − |
| Fly freely | | | W A S D, Q and E for down and up; hold Shift to go 4× faster |
| Details of a point | click | tap | |
| Fly to a point | double-click | | |
| Search | | | / |
| Close the card | | | Esc |

Zooming and flying always adjust to the scale you are at: one notch of the wheel zooms about 1.25×, so
you can go from the planets to the cosmic web in a few spins. The round **Return to the Sun** button in
the bottom bar brings you home.

## Search

Type in the search box (or press **/**). Names from the atlas's own catalogues appear instantly: named
stars like Sirius, Messier and NGC objects like M31, and nearby galaxies. Case and spaces do not
matter, and other names work too (alf CMa finds Sirius). Use the arrow keys and Enter to pick one.

If the name is not in the atlas, choose **Look up in CDS Sesame**: the atlas asks the international
SIMBAD, NED and VizieR name service. If Sesame gives a reliable distance (a good parallax for a star or
a redshift for a galaxy), the camera flies there. If not, the view turns towards the object from the
Sun and says "direction only".

## Layers

The **Layers** panel switches data sets on and off and sets their opacity: [Gaia stars](#layer=stars-gaia),
[DESI](#layer=galaxies-desi), [2MRS](#layer=galaxies-2mrs), [Cosmicflows-4](#layer=galaxies-cf4),
the [Local Group](#layer=local-group) and [Local Volume](#layer=local-volume), the Milky Way model and
the Gaia all-sky image. Below them:

- **Exposure** brightens or dims everything, in magnitudes.
- **Point budget** (0.5 to 12 million points, default 4 million) and **Detail** trade quality for speed.
- **Thin slab** shows only a thin layer (±10 to ±300 Mpc) through the focus, the best way to see the
  [cosmic web](doc:cosmic-web).
- **Labels**, **Distance uncertainty** and the **Performance overlay** can be turned on and off.

## The info card

Click or tap any point. The card shows what it is, its name or catalogue number, its magnitude, colour
or [redshift](doc:redshift), its distance with the 16–84 % range, its position in Galactic and sky
coordinates, and links to SIMBAD, the Gaia archive or the Legacy Surveys image viewer. **Fly here**
takes you to it. **Learn more** opens the article about that kind of object in this docs panel.

## Scale rail, readout and tour

At the bottom, the **scale bar** shows a length in au, pc, kpc, Mpc or Gpc, with the time light needs to
cross it. The **scale rail** is a ruler of camera distance from about 0.04 au to 30 Gpc, marked with
landmarks such as "Proxima", "Milky Way", "Andromeda" and "Cosmic web": click or drag it, or use the
arrow keys on it (Shift for big steps). The readout beside it says how far the focus is from the Sun
and how long ago its light left ([lookback time](doc:lookback-time)).

**Scale tour** flies through six stops: the Sun, Proxima Centauri, the solar neighbourhood, the
Milky Way, the Local Group and the cosmic web, each with a caption. Any mouse or key input stops it.

## Links and uncertainty

The address bar always holds a **deep link** to the current view, the visible layers, the slab and the
selected object. The **Copy link** button copies it, so a friend opens exactly what you see. The
language can be chosen with `?lang=uz`, `?lang=en` or `?lang=ru`.

Every selected object gets a line-of-sight **error bar** from its 16 % to 84 % distance. Tick
*Distance uncertainty* in the Layers panel to stretch nearby points along their error. Read
[distance uncertainty](doc:distance-uncertainty) for what it means.
