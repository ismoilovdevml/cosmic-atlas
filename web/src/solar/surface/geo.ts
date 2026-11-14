/**
 * Planetocentric latitude / east longitude <-> body-fixed <-> Galactic.
 *
 * Body-fixed axes are the ones `bodyFrame()` returns (ephemeris.ts): x = prime meridian on the
 * equator, y = 90° E, z = north pole, all expressed in the Galactic contract frame. The surface
 * tiles (NASA Trek / Murray Lab CTX, equirectangular "Moon 2000" / "Mars 2000 sphere") and the
 * IAU Gazetteer use planetocentric latitude and east-positive longitude, which is this mapping.
 */

import type { Vec3 } from '../../math/frames';
import type { BodyFrame } from '../ephemeris';

const D = Math.PI / 180;

/** unit vector in body-fixed axes for planetocentric (lat, east lon) in degrees */
export function latLonToBody(latDeg: number, lonEastDeg: number): Vec3 {
  const la = latDeg * D;
  const lo = lonEastDeg * D;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** body-fixed components -> Galactic components */
export function bodyToGal(f: BodyFrame, v: Vec3): Vec3 {
  return [
    v[0] * f.x[0] + v[1] * f.y[0] + v[2] * f.z[0],
    v[0] * f.x[1] + v[1] * f.y[1] + v[2] * f.z[1],
    v[0] * f.x[2] + v[1] * f.y[2] + v[2] * f.z[2],
  ];
}

/** Galactic components -> body-fixed components (the frame is orthonormal) */
export function galToBody(f: BodyFrame, g: Vec3): Vec3 {
  return [
    g[0] * f.x[0] + g[1] * f.x[1] + g[2] * f.x[2],
    g[0] * f.y[0] + g[1] * f.y[1] + g[2] * f.y[2],
    g[0] * f.z[0] + g[1] * f.z[1] + g[2] * f.z[2],
  ];
}

/** planetocentric lat / east lon (0..360) of a body-fixed direction, degrees */
export function bodyToLatLon(v: Vec3): { lat: number; lon: number } {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2] / r))) / D;
  let lon = Math.atan2(v[1], v[0]) / D;
  if (lon < 0) lon += 360;
  return { lat, lon };
}

/** Galactic unit vector of a surface direction */
export function latLonToGal(f: BodyFrame, latDeg: number, lonEastDeg: number): Vec3 {
  return bodyToGal(f, latLonToBody(latDeg, lonEastDeg));
}

/** heliocentric Galactic position (pc) of a point `heightPc` above a sphere of radius `rPc` */
export function surfacePoint(bodyPos: Vec3, f: BodyFrame, rPc: number, latDeg: number, lonEastDeg: number, heightPc = 0): Vec3 {
  const n = latLonToGal(f, latDeg, lonEastDeg);
  const r = rPc + heightPc;
  return [bodyPos[0] + n[0] * r, bodyPos[1] + n[1] * r, bodyPos[2] + n[2] * r];
}

/** planetodetic latitude on an ellipsoid (a, c) -> planetocentric latitude, degrees */
export function detic2centric(latDeg: number, a: number, c: number): number {
  return Math.atan(((c * c) / (a * a)) * Math.tan(latDeg * D)) / D;
}

/** great-circle angle between two unit vectors, degrees */
export function angleDeg(a: Vec3, b: Vec3): number {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / D;
}
