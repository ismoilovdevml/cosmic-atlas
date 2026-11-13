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
  message:      { doc: 'interstellar-message',  label: 'kind.message',      color: '#ffd1f0', minScale: 0, maxScale: 1000 },
  seti_signal:  { doc: 'seti',                  label: 'kind.seti_signal',  color: '#ffd1f0', minScale: 0, maxScale: 1e4 },
  model:        { doc: 'milky-way',             label: 'kind.model',        color: '#b9c4d6' },
};

/** kind names used by older catalogues (messier-ngc.json) -> registry kind */
export const KIND_ALIASES: Record<string, string> = {
  planetary_nebula: 'nebula',
  supernova_remnant: 'snr',
  cluster_nebula: 'nebula',
  open_cluster: 'cluster',
  globular_cluster: 'cluster',
  bh: 'black_hole',
};

export function kindInfo(kind: string | undefined): KindInfo {
  const k = kind ? (KINDS[kind] ? kind : KIND_ALIASES[kind]) : undefined;
  return (k && KINDS[k]) || { doc: 'index', label: 'kind.unknown', color: '#cccccc' };
}

/** marker / label colour of a kind (registry colour; unknown kinds grey) */
export function kindColor(kind: string | undefined): string {
  return kindInfo(kind).color;
}

/** The article an object links to: its own `docs` slug if given, else its kind's. */
export function docSlugFor(o: { kind?: string; docs?: string }): string {
  return o.docs || kindInfo(o.kind).doc;
}
