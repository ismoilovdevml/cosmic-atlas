/**
 * Test and capture hooks: window.__atlas (scripts/*.mjs). Loaded as its own chunk once the
 * catalogues and the black hole module are in; nothing here is needed for the first frame.
 */

import type { App } from '../main';
import type { View } from '../nav/controller';
import { radecDistToGal, type Vec3 } from '../math/frames';
import { PC_PER_KMS_MYR, readExtRecord } from '../tiles/format';
import { searchCatalog } from '../data/resolve';
import { flyTargetForLatLon } from '../solar';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export function installDebugApi(app: App) {
  const bh = app.bh; // null if its chunk failed to load
  (window as unknown as { __atlas: unknown }).__atlas = {
    stats: () => ({ backend: app.backend, fps: app.fps, ...app.streamer.stats, budget: app.streamer.pointBudget, view: app.nav.view, slab: app.slabMpc,
      selection: app.selection ? { title: app.selection.title, ref: app.selection.ref, lo: app.selection.lo, hi: app.selection.hi } : null,
      layers: app.layers.map((L) => ({ id: L.cfg.id, status: L.status, active: L.active, count: L.meta?.count ?? 0 })) }),
    setView: (v: Partial<View>) => app.nav.setView(v),
    flyTo: (v: Partial<View>) => app.nav.flyTo(v),
    pickAt: (x: number, y: number) => app.pick(x, y, false),
    setContinuous: (on: boolean) => (app.continuous = on),
    setSlab: (halfMpc: number) => app.setSlab(halfMpc),
    density: () => ({ ...app.densityInfo, kSmoothed: app.densityK }),
    setExposure: (mag: number) => {
      app.exposure = mag;
      app.dirty = true;
    },
    setLayer: (id: string, on: boolean) => app.setLayerVisible(id, on),
    shapes: () => app.shapes.stats(),
    /** view of a catalogue galaxy from the Sun's side, its D25 major axis filling `fill` of the height */
    galaxyView: (name: string, fill = 0.6, fromSun = false) => {
      const e = app.findEntry(name);
      const it = e ? app.shapes.itemFor(e) : null;
      if (!e || !e.xyz || !it) return null;
      const d = Math.hypot(...e.xyz);
      const s = e.xyz.map((v) => v / d);
      // fromSun: camera at the Sun (the Earth view); the caller narrows the field with setFov(fovDeg)
      const fovDeg = (2 * Math.atan(it.R / d / fill) * 180) / Math.PI;
      if (fromSun) return { focus: e.xyz.slice(), dist: d * (1 - 1e-9), yaw: Math.atan2(-s[1], -s[0]), pitch: Math.asin(-s[2]), fovDeg };
      const dist = (2 * it.R) / (fill * 2 * Math.tan((app.camera.fov * Math.PI) / 360));
      return { focus: e.xyz.slice(), dist, yaw: Math.atan2(-s[1], -s[0]), pitch: Math.asin(-s[2]) };
    },
    /** CSS-px screen position of a sky offset (arcmin north / east) from a catalogue object, seen from the camera */
    skyPoint: (name: string, northArcmin: number, eastArcmin: number) => {
      const e = app.findEntry(name);
      if (!e || !e.xyz || e.ra === undefined || e.dec === undefined) return null;
      const dec = e.dec + northArcmin / 60;
      const ra = e.ra + eastArcmin / 60 / Math.cos((e.dec * Math.PI) / 180);
      return app.project(radecDistToGal(ra, dec, e.dist_pc), app.nav.camPos());
    },
    /** vertical field of view in degrees (default 55); narrow fields show the Earth view of a galaxy */
    setFov: (deg: number) => {
      app.camera.fov = deg;
      app.camera.updateProjectionMatrix();
      app.dirty = true;
    },
    showEntry: (name: string) => {
      const e = app.findEntry(name);
      if (e) app.showCatalogEntry(e);
      return !!e;
    },
    setSky: (on: boolean) => app.setLayerVisible(app.skyCfg?.id ?? 'gaia-sky', on),
    // --- Messengers hook (captures / tests): CMB shell, sky background, FRB and neutrino markers
    messengers: {
      state: () => app.msg.debug(),
      /** sky background chooser: 'gaia' | 'erosita' | 'planck857'; resolves once the image is shown */
      setBackground: (id: string) => app.msg.bg?.set(id) ?? Promise.resolve(false),
      /** wait for the CMB texture (it loads lazily, once the camera nears the shell) */
      loadCmb: () => app.msg.cmb?.load() ?? Promise.resolve(),
      /** a catalogue entry's position (pc), for views centred on it */
      entryXyz: (name: string) => app.findEntry(name)?.xyz?.slice() ?? null,
      /** CSS-px screen position of a catalogue entry or sky-marker entry (direction-only ones at infinity) */
      screenOf: (name: string) => {
        const e = app.findEntry(name);
        if (!e) return null;
        const cam = app.nav.camPos();
        if (e.xyz) return app.project(e.xyz, cam);
        if (e.ra === undefined || e.dec === undefined) return null;
        const d = radecDistToGal(e.ra, e.dec, 1e10);
        return app.project([cam[0] + d[0], cam[1] + d[1], cam[2] + d[2]], cam);
      },
      /**
       * the sky in direction (ra, dec) as seen from 1 pc out along it (past the Solar System, the
       * Sun behind the camera; parallax of the sky markers is nil), vertical field fovDeg
       */
      lookAt: (ra: number, dec: number, fovDeg = 55) => {
        const d = radecDistToGal(ra, dec, 1);
        app.camera.fov = fovDeg;
        app.camera.updateProjectionMatrix();
        app.nav.setView({ focus: [2 * d[0], 2 * d[1], 2 * d[2]], dist: 1, yaw: Math.atan2(-d[1], -d[0]), pitch: Math.asin(-d[2]) });
      },
    },
    // --- Solar System hook (captures / tests)
    solar: {
      entries: () => app.solar.entries.map((e) => ({ name: e.name, alt: e.alt, kind: e.kind, distAU: e.dist_pc / 4.84813681109536e-6 })),
      go: (name: string, opts: { dist?: number; yawDeg?: number; pitchDeg?: number; instant?: boolean } = {}) => {
        const e = app.solar.entries.find((x) => x.name === name || x.alt.includes(name));
        if (!e) return false;
        const v = { ...app.solar.viewFor(e), ...(opts.dist ? { dist: opts.dist } : {}) };
        if (opts.yawDeg !== undefined) v.yaw += (opts.yawDeg * Math.PI) / 180;
        if (opts.pitchDeg !== undefined) v.pitch = (opts.pitchDeg * Math.PI) / 180;
        app.showSolar(e);
        if (opts.instant) {
          app.nav.setView(v);
          app.solar.attach(app.solar.bodyIdOf(e));
        } else app.flySolar(e, v);
        return true;
      },
      setTime: (iso: string) => app.solar.clock.set(Date.parse(iso)),
      setSpeed: (s: number) => app.solar.clock.setSpeed(s),
      pause: (p: boolean) => app.solar.clock.setPaused(p),
      now: () => new Date(app.solar.clock.now()).toISOString(),
      pickAt: (x: number, y: number) => app.solar.pickAt(x, y)?.name ?? null,
      screen: () => Object.fromEntries(app.solar.bodies.map((b) => [b.def.id, b.screen])),
      search: (q: string) => searchCatalog(app.catalog, q).map((r) => `${r.entry.name} <- ${r.matched}`),
      layer: app.solar,
      lookDown: (lat: number, lon: number, altKm = 3000) => {
        app.nav.setView(flyTargetForLatLon(lat, lon, app.solar.clock.now(), altKm));
        app.solar.attach('earth');
      },
      // --- Surface hook (captures / tests): tile cache, feature views
      surface: {
        stats: () => ({ cache: { ...app.solar.tileCache.stats }, moon: { ...app.solar.surfaces.get('moon')!.stats }, mars: { ...app.solar.surfaces.get('mars')!.stats } }),
        idle: () => app.solar.tileCache.idle,
        log: () => [...app.solar.tileCache.log],
        setMode: (body: 'moon' | 'mars', mode: 'photo' | 'relief') => app.solar.setSurfaceMode(body, mode),
        /** straight down onto (lat, east lon) of the Moon or Mars from altKm, instantly */
        lookDown: (body: 'moon' | 'mars', lat: number, lon: number, altKm: number) => {
          const v = app.solar.surfaceView(body, lat, lon, altKm);
          app.solar.attach(null);
          app.nav.setView(v);
          app.solar.attach(body);
        },
        /** Sun elevation (deg) at a surface point now */
        sunElev: (body: 'moon' | 'mars', lat: number, lon: number) => app.solar.sunElevation(body, lat, lon),
        feature: (name: string) => {
          const e = app.solar.featureEntries.find((x) => x.name === name || x.alt.includes(name));
          if (!e) return null;
          const f = app.solar.featureOf(e)!;
          return { name: e.name, body: f.body, lat: f.lat, lon: f.lon, diam_km: f.diam_km };
        },
        labels: () => [...document.querySelectorAll<HTMLElement>('.label')].filter((el) => el.style.visibility === 'visible' && +el.style.opacity > 0.5).map((el) => el.textContent),
      },
    },
    // --- Dust hook (captures / tests)
    dust: {
      state: () => ({ status: app.dust.status, active: app.dust.active, amount: app.dust.amount, mode: app.dust.mode, quality: app.dust.quality, visible: app.dust.visible,
        trace: app.dust.shader?.traceTex?.renderTarget ? [app.dust.shader.traceTex.renderTarget.width, app.dust.shader.traceTex.renderTarget.height] : null }),
      setMode: (m: 'auto' | 'absorb' | 'glow') => app.dust.setMode(m),
      setQuality: (q: 'low' | 'medium' | 'high') => app.dust.setQuality(q),
      /** benchmarks: raw march sample count (0 = only the extra scene target and the lookups) */
      setSteps: (n: number) => {
        if (app.dust.shader) app.dust.shader.uSteps.value = n;
        app.dirty = true;
      },
      pickAt: (x: number, y: number) => (app.showDustAt(x, y, false) ? app.selection?.title ?? null : null),
    },
    // --- Black hole hook (captures / tests)
    bh: { ...(bh?.debugApi() ?? {}), experience: (name: string) => {
      const h = bh?.find(name);
      return h && bh ? bh.experience(h, app.nav) : Promise.resolve(false);
    }, setView: (v: Partial<View>) => {
      app.nav.minDist = 1e-14; // the black hole hook sets the real floor (1.5 r_s) on the next frame
      app.nav.setView(v);
    },
    /** mean GPU time per rendered frame (ms) over `ms` of continuous rendering; needs ?gputime (timestamp queries) */
    gpuMs: async (ms = 3000) => {
      // three resolves the GPU duration of the most recent frame: sample it once per frame
      app.continuous = true;
      const t0 = performance.now();
      const r0 = app.totalRenders;
      const v: number[] = [];
      while (performance.now() - t0 < ms) {
        await new Promise((res) => requestAnimationFrame(res));
        const d = await app.renderer.resolveTimestampsAsync('render');
        if (typeof d === 'number' && d > 0) v.push(d);
      }
      app.continuous = false;
      v.sort((a, b) => a - b);
      const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null);
      return { medianMs: q(0.5), p90Ms: q(0.9), samples: v.length, frames: app.totalRenders - r0, wallMs: performance.now() - t0 };
    } },
    setUncertainty: (on: boolean) => {
      app.streamer.uncertainty = on;
      ($('unc-on') as HTMLInputElement).checked = on;
      app.dirty = true;
    },
    /** star epoch, Myr from now (the 4D time slider) */
    setEpoch: (myr: number) => app.epoch.set(myr),
    epoch: () => app.epoch.myr,
    /**
     * test hook: the brightest on-screen moving point of a layer, its catalogue id and its CPU-moved
     * position projected to CSS px (to check that the GPU pick finds it at the same place)
     */
    movedProbe: async (layerId: string) => {
      const cam = app.nav.camPos();
      let best: { id: string; x: number; y: number; xyz: Vec3; lum: number } | null = null;
      for (const n of app.streamer.drawn()) {
        if (n.layer.cfg.id !== layerId || !n.data || !app.streamer.moving(n) || !n.velData) continue;
        const ext = await n.layer.loadExt(n);
        const sv = n.layer.meta!.velocity!.sunVelocity;
        const k = app.epoch.myr * PC_PER_KMS_MYR;
        for (let i = 0; i < n.meta.count; i++) {
          const lum = n.data.rgbl[i * 4 + 3];
          if (best && lum <= best.lum) continue;
          const c = n.meta.center;
          const p = n.data.positions;
          const v = n.velData;
          const xyz: Vec3 = [0, 1, 2].map((ax) => c[ax] + p[i * 3 + ax] + (v[i * 4 + ax] - sv[ax]) * k) as Vec3;
          const s = app.project(xyz, cam);
          if (!s || s.x < 40 || s.y < 40 || s.x > window.innerWidth - 40 || s.y > window.innerHeight - 200) continue;
          best = { id: readExtRecord(ext, i, n.layer.extStride).id.toString(), x: s.x, y: s.y, xyz, lum };
        }
      }
      return best;
    },
  };
}
