/**
 * satellite.js 7.1.0 (MIT), pure-JS SGP4 only. The package index also re-exports its WASM builds,
 * and the pthreads one has a top-level await that the Vite production build rejects
 * ("INVALID_TLA_FORMAT" in the worker bundle), so the JS modules are imported by path here.
 */
export { json2satrec } from '../../node_modules/satellite.js/dist/io.js';
export { gstime, propagate } from '../../node_modules/satellite.js/dist/propagation.js';
export type { OMMJsonObject } from '../../node_modules/satellite.js/dist/common-types.js';
export type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
