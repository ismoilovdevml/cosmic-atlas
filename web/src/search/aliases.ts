/**
 * Multilingual search: what a person may type in Uzbek (Latin or Cyrillic), English or Russian,
 * mapped to something the map can show.
 *
 *   body     a Solar System body id (sun, mercury … neptune, pluto, moon), live positions come from
 *            the Solar System module through a BodyProvider
 *   view     a named view (Milky Way, Local Group, Laniakea …): a camera target + distance
 *   catalog  a catalogue object, by its catalogued names
 *   kind     a generic word ("qora tuynuk", "black holes"): lists matching objects + the article
 *
 * Matching folds case, diacritics and the Uzbek apostrophes (oʻ, gʻ, o', o‘, o) and transliterates
 * Cyrillic to Latin on both sides, so "Сомон йўли", "Somon yoli" and "Somon yoʻli" are one key.
 * Small typos are tolerated (Damerau–Levenshtein, 1 edit from 4 letters, 2 from 8).
 */

import type { Vec3 } from '../math/frames';
import { SCALE_TOUR, type DistRef, type TargetRef } from '../tour/tours';

export type AliasTarget =
  | { type: 'body'; id: string }
  | { type: 'view'; id: string }
  | { type: 'catalog'; names: string[] }
  | { type: 'kind'; kinds: string[]; doc: string; bodies?: string[] };

export interface AliasEntry {
  id: string;
  target: AliasTarget;
  /** i18n key of the display name */
  label: string;
  /** docs article for this target */
  doc?: string;
  names: { uz: string[]; en: string[]; ru: string[] };
}

export interface NamedView {
  target: TargetRef;
  dist: DistRef;
  pitchDeg: number;
  yawDeg?: number;
  /** layers to switch on for this view */
  show?: string[];
  doc?: string;
  /** where the numbers come from */
  ref?: string;
}

/** a tour beat's camera as a named view (one source for the same picture) */
function fromBeat(id: string, extra: Partial<NamedView> = {}): NamedView {
  const b = SCALE_TOUR.beats.find((x) => x.id === id);
  if (!b) throw new Error(`no tour beat ${id}`);
  return { target: b.target, dist: b.dist, pitchDeg: b.pitchDeg, yawDeg: b.yawDeg, show: b.show, ...extra };
}

// Galactic (l, b, d) → heliocentric Galactic xyz, rounded to pc (computed once, see comments)
const LMC: Vec3 = [7564, -40950, -26928]; // l 280.47, b −32.89, 49.59 kpc (Pietrzyński et al. 2019)
const SMC: Vec3 = [24206, -37565, -43608]; // l 302.80, b −44.30, 62.44 kpc (Graczyk et al. 2020)
const M87: Vec3 = [1050720, -4284931, 15899225]; // l 283.78, b 74.49, 16.5 Mpc (Mei et al. 2007)
const NORMA: Vec3 = [55477692, -38371615, -8593303]; // Abell 3627, l 325.33, b −7.26, cz 4871 km/s ≈ 68 Mpc

export const NAMED_VIEWS: Record<string, NamedView> = {
  'solar-system': fromBeat('sun', { doc: 'solar-system' }),
  'milky-way': fromBeat('milky-way', { doc: 'milky-way' }),
  'local-group': fromBeat('local-group', { doc: 'local-group' }),
  'cosmic-web': fromBeat('cosmic-web', { doc: 'cosmic-web' }),
  'galactic-centre': {
    target: { catalog: ['Sgr A*', 'Sagittarius A*', 'Milky Way (Galactic Centre)'], fallback: [8275, 0, 0] },
    dist: 2500, pitchDeg: 25, doc: 'sgr-a-star', ref: 'R0 = 8.275 kpc (GRAVITY Collaboration 2021)',
  },
  andromeda: {
    target: { catalog: ['Andromeda (M31)', 'M31', 'Andromeda Galaxy', 'MESSIER031'], fallback: [-368258, 608681, -281281] },
    dist: 5e4, pitchDeg: 30, doc: 'local-group',
  },
  'magellanic-clouds': {
    target: { between: [{ catalog: ['Large Magellanic Cloud', 'LMC'], fallback: LMC }, { catalog: ['Small Magellanic Cloud', 'SMC'], fallback: SMC }], t: 0.5 },
    dist: 6e4, pitchDeg: 25, doc: 'local-group',
  },
  'virgo-cluster': {
    target: { catalog: ['M87', 'Virgo A', 'Messier 87'], fallback: M87 },
    dist: 1.2e7, pitchDeg: 25, doc: 'galaxy',
  },
  // Laniakea: ~160 Mpc across, centred toward the Great Attractor (Norma cluster region)
  laniakea: {
    target: { xyz: NORMA }, dist: 3.5e8, pitchDeg: 30, doc: 'cosmic-web', show: ['galaxies-2mrs'],
    ref: 'Tully, Courtois, Hoffman & Pomarède 2014, Nature 513, 71 (doi:10.1038/nature13674)',
  },
  'desi-footprint': {
    target: { sun: true }, dist: 1.2e10, pitchDeg: 20, yawDeg: -150, doc: 'desi-survey', show: ['galaxies-desi'],
  },
  // comoving radius of the observable universe ≈ 14.3 Gpc (Planck18); the rail ends at 30 Gpc
  'observable-universe': {
    target: { sun: true }, dist: 3e10, pitchDeg: 25, doc: 'lookback-time', show: ['galaxies-desi'],
  },
};

/** Solar System bodies, in order from the Sun (the Solar System module registers their positions) */
export const BODIES = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
export const PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

const body = (id: string, uz: string[], en: string[], ru: string[]): AliasEntry => ({
  id: `body:${id}`, target: { type: 'body', id }, label: `body.${id}`, doc: id, names: { uz, en, ru },
});
const view = (id: string, uz: string[], en: string[], ru: string[]): AliasEntry => ({
  id: `view:${id}`, target: { type: 'view', id }, label: `view.${id}`, doc: NAMED_VIEWS[id].doc, names: { uz, en, ru },
});
const kind = (id: string, kinds: string[], doc: string, uz: string[], en: string[], ru: string[], bodies?: string[]): AliasEntry => ({
  id: `kind:${id}`, target: { type: 'kind', kinds, doc, bodies }, label: `kind.${id}`, doc, names: { uz, en, ru },
});

export const ALIASES: AliasEntry[] = [
  body('sun', ['Quyosh'], ['Sun', 'the Sun', 'Sol'], ['Солнце']),
  body('mercury', ['Merkuriy', 'Utorud'], ['Mercury'], ['Меркурий']),
  body('venus', ['Venera', 'Zuhro', 'Zuhra', 'Choʻlpon'], ['Venus'], ['Венера']),
  body('earth', ['Yer', 'Yer sayyorasi'], ['Earth', 'the Earth', 'Terra'], ['Земля']),
  body('moon', ['Oy'], ['Moon', 'the Moon', 'Luna'], ['Луна']),
  body('mars', ['Mars', 'Mirrix', 'Mirrikh'], ['Mars'], ['Марс']),
  body('jupiter', ['Yupiter', 'Mushtariy'], ['Jupiter'], ['Юпитер']),
  body('saturn', ['Saturn', 'Zuhal'], ['Saturn'], ['Сатурн']),
  body('uranus', ['Uran'], ['Uranus'], ['Уран']),
  body('neptune', ['Neptun'], ['Neptune'], ['Нептун']),
  body('pluto', ['Pluton'], ['Pluto'], ['Плутон']),

  view('milky-way', ['Somon yoʻli', 'Somon yoʻli galaktikasi', 'Bizning galaktika', 'Galaktikamiz'],
    ['Milky Way', 'the Milky Way', 'Milky Way galaxy', 'our galaxy', 'the Galaxy'], ['Млечный путь', 'Млечный Путь', 'наша галактика']),
  view('galactic-centre', ['Galaktika markazi', 'Somon yoʻli markazi', 'Sgr A*', 'Sagittarius A*'],
    ['Galactic Centre', 'Galactic Center', 'centre of the Milky Way', 'center of the galaxy', 'Sgr A*', 'Sagittarius A*'],
    ['Центр Галактики', 'Галактический центр', 'Стрелец A*']),
  view('local-group', ['Mahalliy guruh', 'Mahalliy galaktikalar guruhi'], ['Local Group'], ['Местная группа', 'Местная группа галактик']),
  view('andromeda', ['Andromeda', 'Andromeda galaktikasi', 'Andromeda tumanligi'],
    ['Andromeda', 'Andromeda Galaxy', 'Andromeda Nebula', 'M31'], ['Андромеда', 'Туманность Андромеды', 'Галактика Андромеды']),
  view('magellanic-clouds', ['Magellan bulutlari', 'Katta Magellan buluti', 'Kichik Magellan buluti'],
    ['Magellanic Clouds', 'Large Magellanic Cloud', 'Small Magellanic Cloud', 'LMC', 'SMC'],
    ['Магеллановы облака', 'Большое Магелланово облако', 'Малое Магелланово облако']),
  view('solar-system', ['Quyosh sistemasi', 'Quyosh tizimi'], ['Solar System', 'the Solar System'], ['Солнечная система']),
  view('cosmic-web', ['Kosmik toʻr', 'Koinot toʻri', 'Olam toʻri'], ['cosmic web', 'large-scale structure', 'filaments'],
    ['космическая паутина', 'крупномасштабная структура']),
  view('observable-universe', ['Kuzatiladigan koinot', 'Kuzatiladigan olam', 'Koinot chegarasi', 'Olam chegarasi'],
    ['observable universe', 'edge of the universe', 'edge of the observable universe', 'cosmic horizon'],
    ['наблюдаемая Вселенная', 'край Вселенной', 'граница наблюдаемой Вселенной']),
  view('virgo-cluster', ['Virgo toʻdasi', 'Sunbula toʻdasi'], ['Virgo Cluster', 'Virgo cluster of galaxies'],
    ['скопление Девы', 'Скопление в Деве']),
  view('laniakea', ['Laniakea', 'Laniakea oʻta toʻdasi'], ['Laniakea', 'Laniakea Supercluster'], ['Ланиакея', 'сверхскопление Ланиакея']),
  view('desi-footprint', ['DESI qamrovi', 'DESI maydoni', 'DESI'], ['DESI footprint', 'DESI survey', 'DESI'], ['область обзора DESI', 'обзор DESI', 'DESI']),

  kind('black_hole', ['black_hole'], 'black-hole', ['qora tuynuk', 'qora tuynuklar'], ['black hole', 'black holes'], ['чёрная дыра', 'чёрные дыры']),
  kind('planet', ['planet'], 'solar-system', ['sayyora', 'sayyoralar', 'planeta', 'planetalar'], ['planet', 'planets'], ['планета', 'планеты'], PLANETS),
  kind('exoplanet', ['exoplanet'], 'exoplanet', ['ekzosayyora', 'ekzosayyoralar', 'ekzoplaneta'], ['exoplanet', 'exoplanets'], ['экзопланета', 'экзопланеты']),
  kind('pulsar', ['pulsar'], 'pulsar', ['pulsar', 'pulsarlar'], ['pulsar', 'pulsars'], ['пульсар', 'пульсары']),
  kind('neutron_star', ['pulsar'], 'neutron-star', ['neytron yulduz', 'neytron yulduzlar'], ['neutron star', 'neutron stars'], ['нейтронная звезда', 'нейтронные звёзды']),
  kind('star', ['star'], 'star', ['yulduz', 'yulduzlar'], ['star', 'stars'], ['звезда', 'звёзды']),
  kind('wd', ['wd'], 'white-dwarf', ['oq mitti', 'oq mittilar'], ['white dwarf', 'white dwarfs'], ['белый карлик', 'белые карлики']),
  kind('galaxy', ['galaxy', 'lg_galaxy'], 'galaxy', ['galaktika', 'galaktikalar'], ['galaxy', 'galaxies'], ['галактика', 'галактики']),
  kind('qso', ['qso'], 'quasar', ['kvazar', 'kvazarlar'], ['quasar', 'quasars', 'QSO'], ['квазар', 'квазары']),
  kind('cluster', ['cluster'], 'star-cluster', ['yulduz toʻdasi', 'yulduz toʻdalari'], ['star cluster', 'star clusters'], ['звёздное скопление', 'звёздные скопления']),
  kind('nebula', ['nebula'], 'nebula', ['tumanlik', 'tumanliklar'], ['nebula', 'nebulae', 'nebulas'], ['туманность', 'туманности']),
  kind('snr', ['snr'], 'supernova-remnant', ['oʻta yangi yulduz qoldigʻi', 'oʻta yangi yulduz qoldiqlari'], ['supernova remnant', 'supernova remnants'],
    ['остаток сверхновой', 'остатки сверхновых']),
  kind('spacecraft', ['spacecraft'], 'spacecraft', ['kosmik apparat', 'kosmik apparatlar', 'zond'], ['spacecraft', 'space probe', 'probes'],
    ['космический аппарат', 'космические аппараты', 'зонд']),
  kind('message', ['message'], 'interstellar-message', ['yulduzlararo xabar', 'Arecibo xabari'], ['interstellar message', 'Arecibo message'],
    ['межзвёздное послание', 'послание Аресибо']),
  kind('seti_signal', ['seti_signal'], 'seti', ['SETI', 'Wow signali'], ['SETI', 'Wow signal', 'alien signal'], ['SETI', 'сигнал Wow']),
];

// ------------------------------------------------------------------ folding

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q',
  л: 'l', м: 'm', н: 'n', о: 'o', ў: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ҳ: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'i', є: 'e',
};

/**
 * Search key: lower case, Cyrillic → Latin (Uzbek-aware: ў → o, ғ → g, қ → q, ҳ → h), diacritics
 * removed, Uzbek apostrophes (ʻ ʼ ' ‘ ’ `) dropped, punctuation → single spaces. `*` and `+` stay
 * (Sgr A*, 3C 273+…).
 */
export function fold(s: string): string {
  let out = '';
  let prevCyr = false;
  for (const ch of s.toLowerCase()) {
    const lat = CYR[ch];
    // word-initial е is "ye" in Uzbek Cyrillic (Ер → Yer) and in Russian pronunciation
    out += ch === 'е' && !prevCyr ? 'ye' : lat ?? ch;
    prevCyr = lat !== undefined;
  }
  return out
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ'‘’`´ʹ]/g, '')
    .replace(/[^a-z0-9*+]+/g, ' ')
    .trim();
}

/** optimal-string-alignment distance (Damerau–Levenshtein with adjacent swaps), capped */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** how well a folded query matches one folded name (0 = not at all, 100 = exact) */
export function scoreName(fq: string, fn: string): number {
  if (!fq || !fn) return 0;
  if (fq === fn) return 100;
  const cq = fq.replace(/ /g, '');
  const cn = fn.replace(/ /g, '');
  if (cq === cn) return 96;
  if (fn.startsWith(fq)) return 85 - Math.min(20, fn.length - fq.length);
  if (fn.includes(` ${fq}`)) return 68 - Math.min(20, fn.length - fq.length);
  if (fq.length < 4) return 0;
  const allowed = fq.length >= 8 ? 2 : 1;
  const d = editDistance(cq, cn, allowed);
  if (d <= allowed) return 62 - 12 * d;
  // typo in a prefix ("andromd" → "andromeda")
  if (cn.length > cq.length) {
    let best = allowed + 1;
    for (const k of [cq.length - 1, cq.length, cq.length + 1]) if (k > 2 && k <= cn.length) best = Math.min(best, editDistance(cq, cn.slice(0, k), allowed));
    if (best <= allowed) return 52 - 12 * best;
  }
  if (fq.length >= 5 && fn.includes(fq)) return 40;
  return 0;
}

export interface AliasMatch {
  entry: AliasEntry;
  /** the name that matched, as written in the table */
  matched: string;
  score: number;
}

const folded = new Map<AliasEntry, { name: string; key: string }[]>();
function keysOf(e: AliasEntry) {
  let k = folded.get(e);
  if (!k) {
    k = [...e.names.uz, ...e.names.en, ...e.names.ru].map((name) => ({ name, key: fold(name) }));
    folded.set(e, k);
  }
  return k;
}

export function matchAliases(q: string, limit = 6, table: AliasEntry[] = ALIASES): AliasMatch[] {
  const fq = fold(q);
  if (!fq) return [];
  const out: AliasMatch[] = [];
  for (const e of table) {
    let best = 0;
    let matched = '';
    for (const { name, key } of keysOf(e)) {
      const s = scoreName(fq, key);
      if (s > best) {
        best = s;
        matched = name;
      }
    }
    if (best > 0) out.push({ entry: e, matched, score: best });
  }
  // ties: bodies and views before generic kind words
  const rank = (m: AliasMatch) => (m.entry.target.type === 'kind' ? 1 : 0);
  out.sort((a, b) => b.score - a.score || rank(a) - rank(b));
  return out.slice(0, limit);
}
