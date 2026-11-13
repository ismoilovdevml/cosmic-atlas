/**
 * "Dot" side of the galaxy LOD crossfade. A galaxy that is drawn as a disk or thumbnail still has
 * its point(s) in the tile layers (local group, local volume, 2MRS, CF4, each with its own
 * distance). Those points are dimmed by the galaxy's dot weight, so dot + disk + thumbnail = 1.
 *
 * A point belongs to a masked galaxy when, seen from the Sun, its direction is within `chord` of
 * the galaxy's (chord of unit vectors ≈ angle) and its heliocentric distance is within ±40 % of
 * the catalogue distance (layers disagree on distances by up to tens of percent). The angular
 * radius is small (5 % of the D25 radius, at least 1 arcmin) so satellites inside the disk's
 * outline, such as M32 next to M31, keep their own dots. Works from any camera position: it uses
 * the Sun's view-space position, which the point materials already have.
 */

import * as THREE from 'three/webgpu';
import { Fn, Loop, float, int, length, log, normalize, select, uniform, uniformArray } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export const MAX_MASKS = 16;

const dirs = Array.from({ length: MAX_MASKS }, () => new THREE.Vector4());
const dats = Array.from({ length: MAX_MASKS }, () => new THREE.Vector4());

/** shared by every galaxy point material */
export const galaxyMask = {
  /** xyz = view-space unit vector Sun → galaxy, w = chord radius */
  dirs,
  /** x = heliocentric distance (pc), y = dot weight */
  dats,
  dirsNode: uniformArray(dirs, 'vec4') as N,
  datsNode: uniformArray(dats, 'vec4') as N,
  count: uniform(0, 'int') as N,
};

/** TSL: multiplicative dot weight for a view-space point P, with the Sun at view-space S */
export const maskFactor: (P: N, S: N) => N = Fn(([P, S]: [N, N]) => {
  const f = float(1.0).toVar();
  const H = P.sub(S);
  const h = length(H);
  const n = H.div(h.max(1e-30));
  Loop({ start: int(0), end: galaxyMask.count, type: 'int', condition: '<' }, ({ i }: { i: N }) => {
    const d = galaxyMask.dirsNode.element(i);
    const e = galaxyMask.datsNode.element(i);
    const inside = length(n.sub(normalize(d.xyz))).lessThan(d.w).and(log(h.div(e.x)).abs().lessThan(0.34));
    f.mulAssign(select(inside, e.y, float(1.0)));
  });
  return f;
}) as N;
