/**
 * Deep-link state in the URL hash:
 *
 *   #v=<fx>,<fy>,<fz>,<D>,<yawDeg>,<pitchDeg>      camera (focus pc, Galactic; camera–focus distance)
 *   &l=<layerId>,~<layerId>,...                     layer visibility (~ = hidden)
 *   &sel=<layerId>:<numericId>@<x>,<y>,<z>          a tile point, by its STABLE catalogue id plus
 *                                                   position (to find the node), never a record index
 *   &sel=cat:<url-encoded name>                     a named catalogue entry
 *
 * skymap encodes survey stars by record index, which breaks on every re-bake; ids survive rebuilds.
 */

import type { Vec3 } from '../math/frames';

export interface HashView {
  focus: Vec3;
  dist: number;
  yawDeg: number;
  pitchDeg: number;
}

export type SelRef = { type: 'point'; layer: string; id: string; xyz: Vec3 } | { type: 'cat'; name: string };

export interface HashState {
  view?: HashView;
  layers?: Record<string, boolean>;
  sel?: SelRef;
}

const num = (x: number, p = 9) => String(+x.toPrecision(p));

export function formatHash(s: HashState): string {
  const parts: string[] = [];
  if (s.view) {
    const v = s.view;
    parts.push(`v=${v.focus.map((x) => num(x)).join(',')},${num(v.dist, 6)},${v.yawDeg.toFixed(2)},${v.pitchDeg.toFixed(2)}`);
  }
  if (s.layers && Object.keys(s.layers).length) {
    parts.push(`l=${Object.entries(s.layers).map(([id, on]) => (on ? id : `~${id}`)).join(',')}`);
  }
  if (s.sel) {
    parts.push(
      s.sel.type === 'cat'
        ? `sel=cat:${encodeURIComponent(s.sel.name)}`
        : `sel=${s.sel.layer}:${s.sel.id}@${s.sel.xyz.map((x) => num(x, 10)).join(',')}`,
    );
  }
  return parts.length ? `#${parts.join('&')}` : '';
}

export function parseHash(hash: string): HashState {
  const out: HashState = {};
  const h = hash.replace(/^#/, '');
  for (const part of h.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === 'v') {
      const n = val.split(',').map(Number);
      if (n.length === 6 && n.every(Number.isFinite) && n[3] > 0)
        out.view = { focus: [n[0], n[1], n[2]], dist: n[3], yawDeg: n[4], pitchDeg: n[5] };
    } else if (key === 'l') {
      out.layers = {};
      for (const tok of val.split(',').filter(Boolean)) {
        if (tok.startsWith('~')) out.layers[tok.slice(1)] = false;
        else out.layers[tok] = true;
      }
    } else if (key === 'sel') {
      if (val.startsWith('cat:')) {
        out.sel = { type: 'cat', name: decodeURIComponent(val.slice(4)) };
      } else {
        const m = val.match(/^([A-Za-z0-9_.-]+):(\d{1,20})@([-\d.e+]+),([-\d.e+]+),([-\d.e+]+)$/i);
        if (m) {
          const xyz = [Number(m[3]), Number(m[4]), Number(m[5])] as Vec3;
          if (xyz.every(Number.isFinite)) out.sel = { type: 'point', layer: m[1], id: m[2], xyz };
        }
      }
    }
  }
  return out;
}
