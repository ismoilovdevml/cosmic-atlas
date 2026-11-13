---
title: Units of distance
summary: Astronomers measure space in astronomical units, light-years and parsecs. One parsec is about 3.26 light-years; the whole atlas works in parsecs.
related: [parallax, lookback-time, distance-uncertainty, how-to-use]
sources:
  - IAU 2012 Resolution B2 (astronomical unit = 149,597,870,700 m), as adopted in astropy.constants.au
  - Mamajek et al. 2015, IAU 2015 Resolution B2, arXiv:1510.06262 (parsec defined as exactly 648000/π au)
  - Speed of light 299,792,458 m/s (exact, SI); Julian year 365.25 days (astropy.units)
  - NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
  - Gaia DR3 parallax of Proxima Centauri, 768.0665 ± 0.0499 mas, VizieR I/355/gaiadr3
  - Cosmic Atlas source code, web/src/math/units.ts
updated: 2026-11-13
---

## What is it?

Kilometres are far too small for space. The distance to the nearest star, written in kilometres, has
fourteen digits. So astronomers use three bigger rulers, and this atlas shows all three.

- **Astronomical unit (au).** The average distance from the Earth to the Sun. Since 2012 it has a fixed
  value: exactly 149,597,870,700 metres, about 150 million km. It is the handy unit inside the
  Solar System.
- **Light-year (ly).** The distance light travels in one year (a Julian year of 365.25 days) in empty
  space: about 9.46 trillion km, or 63,241 au. It is a unit of *distance*, not of time.
- **Parsec (pc).** The distance at which a star would show a [parallax](doc:parallax) of exactly one
  arcsecond. It equals exactly 648,000/π au, which is about 206,265 au, 30.9 trillion km, or
  **3.26 light-years**.

For bigger scales, the usual metric prefixes are added: a kiloparsec (kpc) is 1,000 pc, a megaparsec
(Mpc) is one million pc and a gigaparsec (Gpc) is one billion pc.

## How do we know?

The astronomical unit used to be measured from the motions of the planets. Radar and spacecraft
tracking made it so precise that in 2012 the International Astronomical Union (IAU) simply fixed it as
an exact number of metres. The speed of light is also exact in the SI system (299,792,458 m/s), so the
light-year follows directly.

The parsec comes from geometry. As the Earth moves around the Sun, a nearby star seems to shift a
little against the far background. Half of that yearly shift is the parallax angle. A star one parsec
away would shift by one arcsecond, the width of a coin seen from about 4 km. In 2015 the IAU tied the
parsec to the astronomical unit, so it is now exact as well.

## Surprising but true

- Sunlight takes about 499 seconds, a little over 8 minutes, to reach us. You see the Sun as it was
  8 minutes ago.
- No star is as close as one parsec. The nearest, Proxima Centauri, has a Gaia parallax of
  768.07 milliarcseconds, so it is 1.30 pc (about 4.25 light-years) away.
- Professional astronomers prefer the parsec because it comes straight from the parallax measurement:
  distance in parsecs = 1 / parallax in arcseconds. Light-years are more common in news stories.
- The atlas runs from about 0.04 au to about 30 Gpc on its scale rail: more than 20 powers of ten in
  one picture.

## Where to find it in this atlas

Everything in the atlas is stored in parsecs. The scale bar at the bottom picks the unit for you: au
near the Sun, then pc, kpc, Mpc and Gpc. Under the bar it also gives a light-travel version, such as
"light-days" or "thousand light-years". The info card shows distances in the same units, and for stars
it adds light-years in brackets.

Try it: fly to [Proxima Centauri](#focus=Proxima%20Centauri) (1.30 pc), then to
[Sirius](#focus=Sirius) (2.64 pc), the [Pleiades](#focus=Pleiades) (135 pc), the
[Andromeda Galaxy](#focus=M31) (0.78 Mpc) and finally the [DESI](#layer=galaxies-desi) galaxies,
which reach billions of parsecs. At those distances, read [lookback time](doc:lookback-time) too:
the light from far galaxies is very old.
