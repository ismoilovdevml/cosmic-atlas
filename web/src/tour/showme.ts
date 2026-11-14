/**
 * The "Show me" tour (reverse powers of ten), as data. Its own module so it is fetched on the first
 * click of the button, not with the first frame; the scale tour stays in tours.ts because the named
 * views of search (search/aliases.ts) are built from its beats.
 */

import type { Beat, Tour } from './tours';

/** beats that need the viewer's location; dropped when it is unknown (permission denied) */
export const needsHere = (b: Beat) => 'here' in b.target;

const KM_PC = 1 / 3.0856775814913673e13;

/** "Show me": from the cosmic web down to the viewer's own spot on Earth (reverse powers of ten) */
export const SHOW_ME_TOUR: Tour = {
  id: 'show-me',
  label: 'showme.label',
  stayAtEnd: true,
  beats: [
    {
      id: 'web', target: { sun: true }, dist: { galaxyEdge: 1.4 }, pitchDeg: 29, dwellMs: 4200,
      title: 'tour.me.web.title', text: 'tour.me.web.text',
    },
    {
      id: 'local-group',
      target: { between: [{ gc: true }, { catalog: ['Andromeda (M31)', 'M31', 'Andromeda Galaxy'], fallback: [-368258, 608681, -281281] }], t: 0.4 },
      dist: 2.6e6, pitchDeg: 29, dwellMs: 3800, title: 'tour.me.lg.title', text: 'tour.me.lg.text',
    },
    {
      id: 'milky-way', target: { gc: true }, dist: 7e4, pitchDeg: 87.5, dwellMs: 4200, show: ['milky-way-model'],
      title: 'tour.me.mw.title', text: 'tour.me.mw.text',
    },
    {
      id: 'neighbours', target: { sun: true }, dist: 6, pitchDeg: 22, dwellMs: 3600,
      title: 'tour.me.near.title', text: 'tour.me.near.text',
    },
    {
      id: 'solar', target: { sun: true }, dist: 2.4e-4, pitchDeg: 35, dwellMs: 3800, show: ['solar'],
      title: 'tour.me.solar.title', text: 'tour.me.solar.text',
    },
    {
      id: 'earth', target: { body: 'earth', fallback: [0, 0, 0] }, dist: 2.6e-8, pitchDeg: 25, yawDeg: 40, sunSide: true,
      dwellMs: 3600, show: ['solar'], follow: 'earth', title: 'tour.me.earth.title', text: 'tour.me.earth.text',
    },
    {
      id: 'region', target: { here: true }, dist: 4500 * KM_PC, pitchDeg: 0, dwellMs: 3200, show: ['solar'], follow: 'earth',
      title: 'tour.me.region.title', text: 'tour.me.region.text',
    },
    {
      id: 'here', target: { here: true }, dist: 1200 * KM_PC, pitchDeg: 0, dwellMs: 0, show: ['solar'], follow: 'earth',
      title: 'tour.me.here.title', text: 'tour.me.here.text',
    },
  ],
};
