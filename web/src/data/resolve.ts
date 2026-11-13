/**
 * Name search: local catalogues first (instant), CDS Sesame as fallback.
 *
 * CORS (checked 2026-11-13 with an Origin header):
 *   cds.unistra.fr/cgi-bin/nph-sesame   -> 302 to vizier.idia.ac.za, the redirect carries no
 *                                          Access-Control-Allow-Origin, so browsers block it.
 *   vizier.cfa.harvard.edu/viz-bin/nph-sesame -> 200 with Access-Control-Allow-Origin: *
 *   vizier.idia.ac.za/viz-bin/nph-sesame      -> 200 with access-control-allow-origin: *
 * So the viewer queries the CfA mirror and falls back to the IDIA mirror.
 *
 * Distance rules (same frame/conventions as the data contract):
 *   - parallax used only if plx / err >= 5  (galaxies often carry meaningless Gaia parallaxes)
 *   - else redshift (z, or cz from Vel) -> Planck18 comoving distance, only for z >= 0.003
 *     (the contract forbids Hubble-flow distances below that)
 *   - else the direction is known but the distance is not; the caller says so.
 */

import { comovingDistancePc } from '../math/cosmology';
import { radecDistToGal, type Vec3 } from '../math/frames';
import type { CatalogEntry } from './manifest';

export const SESAME_MIRRORS = [
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oxp/SNV?',
  'https://vizier.idia.ac.za/viz-bin/nph-sesame/-oxp/SNV?',
];

export interface Resolved {
  name: string;
  kind: string;
  ra: number;
  dec: number;
  distPc: number | null;
  distSource: string;
  xyz: Vec3 | null;
  /** unit vector toward the object, always available */
  dir: Vec3;
  otype?: string;
  z?: number;
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : null;
}

function block(xml: string, name: string): { v: number; e: number | null } | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return null;
  const v = tag(m[1], 'v');
  const e = tag(m[1], 'e');
  if (v === null || !isFinite(+v)) return null;
  return { v: +v, e: e !== null && isFinite(+e) ? +e : null };
}

const GALAXY_OTYPES = /^(G|GiG|GiC|GiP|BiC|IG|PaG|SBG|SyG|Sy1|Sy2|AGN|QSO|Bla|BLL|LIN|EmG|H2G|LSB|rG|AG\?|Q\?|G\?|LeG|ClG|GrG|CGG|SCG|PCG)$/;

/** Parse one Sesame -oxp XML answer. Exported for tests. */
export function parseSesame(xml: string, query: string): Resolved | null {
  if (!/<Resolver/.test(xml)) return null;
  const ra = tag(xml, 'jradeg');
  const dec = tag(xml, 'jdedeg');
  if (ra === null || dec === null) return null;
  const otype = tag(xml, 'otype') ?? '';
  const name = (tag(xml, 'oname') ?? query).replace(/\s+/g, ' ');
  const plx = block(xml, 'plx');
  const zb = block(xml, 'z');
  const vel = block(xml, 'Vel');
  const isGalaxy = GALAXY_OTYPES.test(otype);
  let distPc: number | null = null;
  let distSource = 'unknown';
  let z: number | undefined;
  if (plx && plx.v > 0 && plx.e && plx.v / plx.e >= 5 && !isGalaxy) {
    distPc = 1000 / plx.v;
    distSource = `parallax ${plx.v.toFixed(3)} ± ${plx.e.toFixed(3)} mas`;
  } else {
    z = zb ? zb.v : vel ? vel.v / 299792.458 : undefined;
    if (z !== undefined && z >= 0.003) {
      distPc = comovingDistancePc(z);
      distSource = `redshift z = ${z.toFixed(5)} (Planck18 comoving)`;
    } else if (z !== undefined) {
      distSource = `z = ${z.toFixed(5)} is below 0.003, too small for a Hubble-flow distance`;
    } else {
      distSource = 'no parallax or redshift in Sesame';
    }
  }
  const dir = radecDistToGal(+ra, +dec, 1);
  return {
    name,
    kind: isGalaxy ? 'galaxy' : 'star',
    ra: +ra,
    dec: +dec,
    distPc,
    distSource,
    xyz: distPc !== null ? [dir[0] * distPc, dir[1] * distPc, dir[2] * distPc] : null,
    dir,
    otype,
    z,
  };
}

export async function resolveSesame(query: string, signal?: AbortSignal): Promise<Resolved | null> {
  let lastErr: unknown = null;
  for (const base of SESAME_MIRRORS) {
    try {
      const r = await fetch(base + encodeURIComponent(query), { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseSesame(await r.text(), query);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw new Error(`Sesame unreachable (${(lastErr as Error)?.message ?? 'network error'})`);
}

/** normalise for matching: lower case, no spaces/punctuation */
export function normName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9*+]/g, '');
}

export interface Suggestion {
  entry: CatalogEntry;
  matched: string;
  score: number;
}

export function searchCatalog(entries: CatalogEntry[], q: string, limit = 8): Suggestion[] {
  const nq = normName(q);
  if (!nq) return [];
  const out: Suggestion[] = [];
  for (const e of entries) {
    let best = 0;
    let matched = e.name;
    for (const cand of [e.name, ...(e.alt ?? [])]) {
      const nc = normName(cand);
      let s = 0;
      if (nc === nq) s = 100;
      else if (nc.startsWith(nq)) s = 70 - Math.min(20, nc.length - nq.length);
      else if (nc.includes(nq)) s = 40 - Math.min(20, nc.length - nq.length);
      if (cand !== e.name) s -= 5;
      if (s > best) {
        best = s;
        matched = cand;
      }
    }
    if (best > 0) out.push({ entry: e, matched, score: best });
  }
  out.sort((a, b) => b.score - a.score || (a.entry.mag ?? 99) - (b.entry.mag ?? 99));
  return out.slice(0, limit);
}

/** a comfortable viewing distance for a kind of object */
export function viewDistanceFor(kind: string, distPc: number): number {
  switch (kind) {
    case 'star':
    case 'wd':
      return Math.max(0.05, Math.min(1.5, distPc * 0.05 || 1));
    case 'cluster':
      return 25;
    case 'bh':
      return 60;
    case 'lg_galaxy':
      return 40_000;
    case 'galaxy':
    case 'qso':
      return 150_000;
    case 'exoplanet':
    case 'message':
      return Math.max(0.05, Math.min(1.5, distPc * 0.05 || 1));
    case 'pulsar':
    case 'nebula':
    case 'snr':
    case 'seti_signal':
      return Math.max(1, Math.min(60, distPc * 0.02 || 20));
    case 'black_hole':
      // stellar BHs like stars nearby; SMBHs in other galaxies framed at galaxy scale
      return distPc > 1e5 ? 150_000 : Math.max(1, Math.min(60, distPc * 0.02 || 20));
    default:
      return 1000;
  }
}
