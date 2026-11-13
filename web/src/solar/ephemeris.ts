/**
 * Solar System ephemerides in the contract frame (docs/data-contract.md §1: heliocentric Galactic
 * Cartesian, pc, +x to the Galactic Centre, +z to the NGP).
 *
 * astronomy-engine returns J2000 mean-equator (EQJ) vectors in AU, geometric (no light time).
 * EQJ differs from ICRS by the ~23 mas frame bias, far below anything drawn here, so the ICRS ->
 * Galactic matrix in math/frames.ts converts them. Checked against JPL Horizons in
 * test/ephemeris.test.ts.
 */

import {
  AstroTime, Body, GeoMoon, HelioVector, JupiterMoons, MakeTime, ObserverVector, Observer, RotateVector, RotationAxis,
  Rotation_EQD_EQJ, SiderealTime, Vector, type JupiterMoonsInfo,
} from 'astronomy-engine';
import { ICRS_TO_GAL, mulMat3, type Vec3 } from '../math/frames';
import { PC_PER_AU } from '../math/units';
import { BODIES, BODY_BY_ID, type BodyDef, type BodyId } from './bodies';

export const AE_VERSION = '2.1.19';
const DEG = Math.PI / 180;

export type TimeLike = Date | number | AstroTime;

export function astroTime(t: TimeLike): AstroTime {
  if (t instanceof AstroTime) return t;
  return MakeTime(typeof t === 'number' ? new Date(t) : t);
}

/** JD in TDB (treated as TT, < 2 ms apart) -> AstroTime */
export function timeFromJdTdb(jd: number): AstroTime {
  return AstroTime.FromTerrestrialTime(jd - 2451545.0);
}

/** EQJ vector in AU -> Galactic, pc */
export function eqjAuToGalPc(x: number, y: number, z: number): Vec3 {
  const g = mulMat3(ICRS_TO_GAL, [x, y, z]);
  return [g[0] * PC_PER_AU, g[1] * PC_PER_AU, g[2] * PC_PER_AU];
}

/** EQJ direction -> Galactic direction (no scaling) */
function eqjDirToGal(x: number, y: number, z: number): Vec3 {
  return mulMat3(ICRS_TO_GAL, [x, y, z]);
}

const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'] as const;
type Galilean = (typeof GALILEAN)[number];
const isGalilean = (id: BodyId): id is Galilean => (GALILEAN as readonly string[]).includes(id);

/** position of a body relative to its parent (EQJ AU): heliocentric for planets, planet-centric for moons */
function relToParentAu(def: BodyDef, t: AstroTime, jm?: JupiterMoonsInfo): Vector | { x: number; y: number; z: number } {
  if (def.id === 'moon') return GeoMoon(t);
  if (isGalilean(def.id)) return (jm ?? JupiterMoons(t))[def.id];
  if (def.id === 'sun') return { x: 0, y: 0, z: 0 };
  return HelioVector(def.ae!, t);
}

/** heliocentric position of one body (pc, contract frame) */
export function heliocentricPc(id: BodyId, t: TimeLike): Vec3 {
  const at = astroTime(t);
  if (id === 'sun') return [0, 0, 0];
  if (id === 'moon') {
    const v = HelioVector(Body.Moon, at);
    return eqjAuToGalPc(v.x, v.y, v.z);
  }
  if (isGalilean(id)) {
    const j = HelioVector(Body.Jupiter, at);
    const m = JupiterMoons(at)[id];
    return eqjAuToGalPc(j.x + m.x, j.y + m.y, j.z + m.z);
  }
  const v = HelioVector(BODY_BY_ID.get(id)!.ae!, at);
  return eqjAuToGalPc(v.x, v.y, v.z);
}

/** heliocentric positions of every body at one time (Jupiter's moons share one series evaluation) */
export function solarPositions(t: TimeLike, out: Partial<Record<BodyId, Vec3>> = {}): Record<BodyId, Vec3> {
  const at = astroTime(t);
  const jm = JupiterMoons(at);
  const helioAu: Partial<Record<BodyId, { x: number; y: number; z: number }>> = {};
  for (const b of BODIES) {
    let v: { x: number; y: number; z: number };
    if (b.id === 'sun') v = { x: 0, y: 0, z: 0 };
    else if (b.id === 'moon') v = HelioVector(Body.Moon, at);
    else if (isGalilean(b.id)) {
      const j = helioAu.jupiter!;
      const m = jm[b.id];
      v = { x: j.x + m.x, y: j.y + m.y, z: j.z + m.z };
    } else v = HelioVector(b.ae!, at);
    helioAu[b.id] = v;
    const g = eqjAuToGalPc(v.x, v.y, v.z);
    const o = out[b.id];
    if (o) (o[0] = g[0]), (o[1] = g[1]), (o[2] = g[2]);
    else out[b.id] = g;
  }
  return out as Record<BodyId, Vec3>;
}

/**
 * One orbit about the parent, centred on time `tc` (so the body sits mid-polyline), as positions
 * relative to the parent in pc (Galactic). Planets: heliocentric; moons: planet-centric.
 */
export function sampleOrbit(id: BodyId, tc: TimeLike, n: number): Float64Array {
  const def = BODY_BY_ID.get(id)!;
  const P = def.periodDays ?? 365.25;
  const t0 = astroTime(tc);
  const out = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const t = t0.AddDays(P * (i / n - 0.5));
    const v = relToParentAu(def, t);
    const g = eqjAuToGalPc(v.x, v.y, v.z);
    out[i * 3] = g[0];
    out[i * 3 + 1] = g[1];
    out[i * 3 + 2] = g[2];
  }
  return out;
}

export interface BodyFrame {
  /** body-fixed axes in the Galactic frame: x = prime meridian on the equator, y = 90° E, z = north pole */
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function unit(a: Vec3): Vec3 {
  const r = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / r, a[1] / r, a[2] / r];
}

/**
 * Earth's body-fixed frame: Greenwich apparent sidereal time about the true pole of date,
 * rotated from the equator of date to J2000 (precession + nutation), then to Galactic.
 * Polar motion (~10 m) and UT1-UTC (< 0.9 s) are ignored.
 */
export function earthFrame(t: TimeLike): BodyFrame {
  const at = astroTime(t);
  const gast = SiderealTime(at) * 15 * DEG;
  const rot = Rotation_EQD_EQJ(at);
  const toGal = (x: number, y: number, z: number) => {
    const v = RotateVector(rot, new Vector(x, y, z, at));
    return eqjDirToGal(v.x, v.y, v.z);
  };
  return {
    x: toGal(Math.cos(gast), Math.sin(gast), 0),
    y: toGal(-Math.sin(gast), Math.cos(gast), 0),
    z: toGal(0, 0, 1),
  };
}

/**
 * Body-fixed frame from the IAU WGCCRE 2015 rotation model (astronomy-engine RotationAxis):
 * pole (α0, δ0) and prime-meridian angle W measured from the ascending node of the body's equator
 * on the ICRF equator. The Galilean moons are taken as tidally locked (longitude 0 faces Jupiter,
 * pole = Jupiter's pole), which is what they are to well under a degree.
 */
export function bodyFrame(id: BodyId, t: TimeLike, rel?: { pos: Vec3; parentPos: Vec3 }): BodyFrame {
  const at = astroTime(t);
  if (id === 'earth') return earthFrame(at);
  if (isGalilean(id)) {
    const jf = bodyFrame('jupiter', at);
    const z = jf.z;
    let toJ: Vec3 = rel ? [rel.parentPos[0] - rel.pos[0], rel.parentPos[1] - rel.pos[1], rel.parentPos[2] - rel.pos[2]] : jf.x;
    const d = toJ[0] * z[0] + toJ[1] * z[1] + toJ[2] * z[2];
    toJ = unit([toJ[0] - d * z[0], toJ[1] - d * z[1], toJ[2] - d * z[2]]);
    return { x: toJ, y: cross(z, toJ), z };
  }
  const def = BODY_BY_ID.get(id)!;
  const ax = RotationAxis(def.ae!, at);
  const a0 = ax.ra * 15 * DEG;
  const d0 = ax.dec * DEG;
  const W = ax.spin * DEG;
  const P: Vec3 = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const N: Vec3 = [-Math.sin(a0), Math.cos(a0), 0]; // ascending node of the body equator on the ICRF equator
  const M = cross(P, N);
  const xq: Vec3 = [Math.cos(W) * N[0] + Math.sin(W) * M[0], Math.cos(W) * N[1] + Math.sin(W) * M[1], Math.cos(W) * N[2] + Math.sin(W) * M[2]];
  const yq = cross(P, xq);
  return { x: eqjDirToGal(...xq), y: eqjDirToGal(...yq), z: eqjDirToGal(...P) };
}

/**
 * Heliocentric position (pc, contract frame) of a point on the Earth's surface: the Earth's
 * centre plus astronomy-engine's geocentric observer vector (WGS-84 ellipsoid, J2000 axes).
 */
export function observerGalacticXyz(latDeg: number, lonDeg: number, heightM: number, date: TimeLike): Vec3 {
  const at = astroTime(date);
  const e = heliocentricPc('earth', at);
  const o = ObserverVector(at, new Observer(latDeg, lonDeg, heightM), false);
  const g = eqjAuToGalPc(o.x, o.y, o.z);
  return [e[0] + g[0], e[1] + g[1], e[2] + g[2]];
}

/** geocentric offset of an Earth-surface point (pc, Galactic axes) */
export function observerGeocentricPc(latDeg: number, lonDeg: number, heightM: number, date: TimeLike): Vec3 {
  const at = astroTime(date);
  const o = ObserverVector(at, new Observer(latDeg, lonDeg, heightM), false);
  return eqjAuToGalPc(o.x, o.y, o.z);
}

export interface LatLonView {
  focus: Vec3;
  dist: number;
  yaw: number;
  pitch: number;
}

/**
 * A camera view (NavController `View` shape) looking straight down at a point on the Earth from
 * `altitudeKm` above it, at `date`. The focus is the surface point; the camera sits along the
 * local vertical (geocentric radial direction).
 */
export function flyTargetForLatLon(latDeg: number, lonDeg: number, date: TimeLike = Date.now(), altitudeKm = 3000): LatLonView {
  const at = astroTime(date);
  const focus = observerGalacticXyz(latDeg, lonDeg, 0, at);
  const up = unit(observerGeocentricPc(latDeg, lonDeg, 0, at));
  return {
    focus,
    dist: (altitudeKm / 149597870.7) * PC_PER_AU,
    yaw: Math.atan2(up[1], up[0]),
    pitch: Math.asin(Math.max(-1, Math.min(1, up[2]))),
  };
}
