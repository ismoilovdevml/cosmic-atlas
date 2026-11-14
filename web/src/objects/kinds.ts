/**
 * Object kind registry (docs/content-contract.md §2). One entry per `kind` used by catalogues,
 * tiles and the Solar System. Add new kinds here first.
 */

export interface KindInfo {
  /** docs article slug the info card links to (web/public/docs/<lang>/<slug>.md) */
  doc: string;
  /** i18n key of the singular label shown on the info card ("kind.black_hole") */
  label: string;
  /** marker colour (sRGB hex) for catalogue markers and labels */
  color: string;
  /** label visibility range: camera distance in pc */
  minScale?: number;
  maxScale?: number;
}

export const KINDS: Record<string, KindInfo> = {
  star:         { doc: 'star',                  label: 'kind.star',         color: '#f4e6c8' },
  wd:           { doc: 'white-dwarf',           label: 'kind.wd',           color: '#cfe3ff' },
  galaxy:       { doc: 'galaxy',                label: 'kind.galaxy',       color: '#f0c9a8' },
  qso:          { doc: 'quasar',                label: 'kind.qso',          color: '#9fe6ff' },
  lg_galaxy:    { doc: 'local-group',           label: 'kind.lg_galaxy',    color: '#f0c9a8' },
  cluster:      { doc: 'star-cluster',          label: 'kind.cluster',      color: '#ffe9a8' },
  nebula:       { doc: 'nebula',                label: 'kind.nebula',       color: '#ff9fb2', minScale: 1, maxScale: 3e4 },
  snr:          { doc: 'supernova-remnant',     label: 'kind.snr',          color: '#ffb38a', minScale: 1, maxScale: 3e4 },
  pulsar:       { doc: 'pulsar',                label: 'kind.pulsar',       color: '#a8f0e0', minScale: 1, maxScale: 3e4 },
  // SMBHs sit in other galaxies (M87* at 16.8 Mpc), so the window reaches galaxy scales
  black_hole:   { doc: 'black-hole',            label: 'kind.black_hole',   color: '#c9a8ff', minScale: 1, maxScale: 2e8 },
  exoplanet:    { doc: 'exoplanet',             label: 'kind.exoplanet',    color: '#9fd8a8', minScale: 0, maxScale: 3000 },
  sun:          { doc: 'sun',                   label: 'kind.sun',          color: '#ffd27a' },
  planet:       { doc: 'solar-system',          label: 'kind.planet',       color: '#d9c7a3' },
  dwarf_planet: { doc: 'solar-system',          label: 'kind.dwarf_planet', color: '#bdb3a3' },
  moon:         { doc: 'moon',                  label: 'kind.moon',         color: '#cfcfcf' },
  spacecraft:   { doc: 'spacecraft',            label: 'kind.spacecraft',   color: '#e8e8e8' },
  // named places on the Moon and Mars (IAU gazetteer, landing sites); only labelled close to the body
  surface_feature: { doc: 'moon',               label: 'kind.surface_feature', color: '#e6dccb', minScale: 0, maxScale: 0.3 },
  landing_site: { doc: 'moon',                  label: 'kind.landing_site', color: '#ffd27a', minScale: 0, maxScale: 0.3 },
  message:      { doc: 'interstellar-message',  label: 'kind.message',      color: '#ffd1f0', minScale: 0, maxScale: 1000 },
  seti_signal:  { doc: 'seti',                  label: 'kind.seti_signal',  color: '#ffd1f0', minScale: 0, maxScale: 1e4 },
  model:        { doc: 'milky-way',             label: 'kind.model',        color: '#b9c4d6' },
  // gravitational-wave mergers: 40 Mpc to ~3.5 Gpc comoving; the label marks a localisation volume, not a point
  gw_event:     { doc: 'gravitational-waves',   label: 'kind.gw_event',     color: '#8fb8ff', minScale: 1e6, maxScale: 3e10 },
  // multi-messenger (src/messengers): hosts and sources out to ~3.4 Gpc; the CMB only from beyond the cosmic web
  frb:          { doc: 'fast-radio-burst',      label: 'kind.frb',          color: '#ff9ad8', minScale: 1e6, maxScale: 2e10 },
  neutrino:     { doc: 'neutrino',              label: 'kind.neutrino',     color: '#8ff3ff', minScale: 1e6, maxScale: 2e10 },
  cmb:          { doc: 'cmb',                   label: 'kind.cmb',          color: '#f2c9a0', minScale: 6e9 },
  // the viewer's own place on Earth (Show me); only drawn within ~0.1 AU
  here:         { doc: 'earth',                 label: 'kind.here',         color: '#ffd27a', minScale: 0, maxScale: 5e-7 },
};

/**
 * Finer kinds the current catalogue builds still emit (Messier/NGC, dev placeholder). Each maps to a
 * registry kind for docs and colour, with its own label key. Catalogues should move to the KINDS ids.
 */
export const SUBKINDS: Record<string, { kind: string; label: string }> = {
  open_cluster:      { kind: 'cluster',    label: 'kind.open_cluster' },
  globular_cluster:  { kind: 'cluster',    label: 'kind.globular_cluster' },
  association:       { kind: 'cluster',    label: 'kind.association' },
  planetary_nebula:  { kind: 'nebula',     label: 'kind.planetary_nebula' },
  cluster_nebula:    { kind: 'nebula',     label: 'kind.cluster_nebula' },
  supernova_remnant: { kind: 'snr',        label: 'kind.snr' },
  double_star:       { kind: 'star',       label: 'kind.double_star' },
  bh:                { kind: 'black_hole', label: 'kind.black_hole' },
};

export function kindInfo(kind: string | undefined): KindInfo {
  if (kind && KINDS[kind]) return KINDS[kind];
  const sub = kind ? SUBKINDS[kind] : undefined;
  if (sub) return { ...KINDS[sub.kind], label: sub.label };
  return { doc: 'index', label: 'kind.unknown', color: '#cccccc' };
}

/** registry kind of a kind or sub-kind ('open_cluster' → 'cluster'); unknown kinds pass through */
export function baseKind(kind: string): string {
  return SUBKINDS[kind]?.kind ?? kind;
}

/** best registry kind for a SIMBAD object type (Sesame results), for the docs link */
export function kindFromOtype(otype: string | undefined, fallback: string): string {
  const o = (otype ?? '').trim();
  if (/^(QSO|Bla|BLL|Q\?)$/.test(o)) return 'qso';
  if (/^(Psr|PSR)$/.test(o)) return 'pulsar';
  if (/^(WD\*|WD\?|wd\*)$/.test(o)) return 'wd';
  if (/^(SNR|SR\?)$/.test(o)) return 'snr';
  if (/^(PN|PN\?|HII|RNe|EmO|ISM|MoC|GNe|DNe|BNe|SFR)$/.test(o)) return 'nebula';
  if (/^(OpC|GlC|Cl\*|As\*|C\?\*|Gl\?)$/.test(o)) return 'cluster';
  if (/^(BH|BH\?|XB\*|HXB|LXB)$/.test(o)) return 'black_hole';  if (/^(Pl|Pl\?)$/.test(o)) return 'exoplanet';
  if (/^(ClG|GrG|CGG|SCG|PCG)$/.test(o)) return 'galaxy';
  if (o === 'FRB') return 'frb';
  return fallback;
}

/** sub-kind → registry kind (main's name for the same table) */
export const KIND_ALIASES: Record<string, string> = Object.fromEntries(Object.entries(SUBKINDS).map(([k, v]) => [k, v.kind]));

/** marker / label colour of a kind (registry colour; unknown kinds grey) */
export function kindColor(kind: string | undefined): string {
  return kindInfo(kind).color;
}

/** The article an object links to: its own `docs` slug if given, else its kind's. */
export function docSlugFor(o: { kind?: string; docs?: string }): string {
  return o.docs || kindInfo(o.kind).doc;
}
