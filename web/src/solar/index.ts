/**
 * Solar System module: live ephemerides (astronomy-engine), rendering, time control, probes.
 *
 * Public API for other features (e.g. "Show me" geolocation flights):
 *   observerGalacticXyz(latDeg, lonDeg, heightM, date) -> heliocentric Galactic pc of a surface point
 *   flyTargetForLatLon(latDeg, lonDeg, date?, altitudeKm?) -> NavController View looking straight down
 *   heliocentricPc(bodyId, date) -> a body's position (pc, contract frame)
 * All take the simulation date; use `solar.clock.now()` to stay in step with what is drawn.
 */

export { BODIES, NOT_SHOWN, type BodyId } from './bodies';
export { SimClock } from './clock';
export { earthFrame, flyTargetForLatLon, heliocentricPc, observerGalacticXyz, observerGeocentricPc, type LatLonView } from './ephemeris';
export { solarInfo } from './info';
export { SOLAR_LABEL_MAX, SolarSystem, WORLD_PER_PC, type SolarEntry } from './layer';
export { tr } from './strings';
export { TimeBar } from './timebar';
