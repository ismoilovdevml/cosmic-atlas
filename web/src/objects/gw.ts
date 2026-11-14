/**
 * Info-card helpers for gravitational-wave events (kind gw_event, gw-events.json) and for points
 * of the star-clusters tile layer (scripts/build_clusters.py). Kept out of main.ts.
 */

import type { CatalogEntry } from '../data/manifest';
import { fmtFixed, t } from '../i18n';
import type { Vec3 } from '../math/frames';
import { formatDistance, formatRange } from '../math/units';

type GwExtra = { gwosc?: string; host?: string; loc?: unknown };

/** the plain-language position warning of a GW card (empty for other kinds) */
export function gwNote(e: CatalogEntry): string {
  if (e.kind !== 'gw_event') return '';
  const x = e as CatalogEntry & GwExtra;
  if (x.host) return t('gw.noteHost', { host: x.host });
  const v = e.facts?.vol90_mpc3;
  const vol = typeof v === 'number' ? fmtVolume(v) : '?';
  return t('gw.noteUncertain', { vol });
}

/** Mpc³ in a×10ⁿ form for big volumes, plain below 10⁵ */
export function fmtVolume(v: number): string {
  if (v < 1e5) return fmtFixed(v, 0);
  const e = Math.floor(Math.log10(v));
  const m = v / 10 ** e;
  const sup = String(e).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('');
  return `${fmtFixed(m, 1)}×10${sup}`;
}

/** extra card links: the GWOSC event page, and the host galaxy in this atlas (same tab) */
export function gwLinks(e: CatalogEntry): [string, string][] {
  const x = e as CatalogEntry & GwExtra;
  const out: [string, string][] = [];
  if (x.host) out.push([t('link.host', { host: x.host }), `#focus=${encodeURIComponent(x.host)}`]);
  if (x.gwosc && /^https:\/\/gwosc\.org\//.test(x.gwosc)) out.push([t('link.gwosc'), x.gwosc]);
  return out;
}

/** catalogue entry of a base kind within `tolPc` (+1e-4 relative) of a position, or null */
export function nearestEntry(catalog: CatalogEntry[], xyz: Vec3, kinds: string[], tolPc = 0.05): CatalogEntry | null {
  const r = Math.hypot(...xyz);
  const tol = tolPc + r * 1e-4;
  let best: CatalogEntry | null = null;
  let bd = Infinity;
  for (const e of catalog) {
    if (!e.xyz || !kinds.includes(e.kind)) continue;
    const d = Math.hypot(e.xyz[0] - xyz[0], e.xyz[1] - xyz[1], e.xyz[2] - xyz[2]);
    if (d < tol && d < bd) [best, bd] = [e, d];
  }
  return best;
}

/** card of a star-clusters point that clusters.json does not carry (a moving group beyond 250 pc) */
export function clusterPointCard(o: { id: string; xyz: Vec3; lo?: number; hi?: number }): { title: string; rows: [string, string][]; links: [string, string][] } {
  const d = Math.hypot(...o.xyz);
  const rows: [string, string][] = [
    [t('facts.type'), t('facts.val.moving_group')],
    [t('row.distance'), formatDistance(d, 4)],
  ];
  if (o.lo !== undefined && o.hi !== undefined && Number.isFinite(o.lo) && Number.isFinite(o.hi)) rows.push([t('row.range'), formatRange(o.lo, o.hi)]);
  const links: [string, string][] = o.id
    ? [[t('link.vizierCluster'), `https://vizier.cfa.harvard.edu/viz-bin/VizieR-5?-source=J/A%2BA/686/A42/clusters&ID=${encodeURIComponent(o.id)}`]]
    : [];
  return { title: o.id ? t('cluster.pointTitle', { id: o.id }) : t('kind.cluster'), rows, links };
}
