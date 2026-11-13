import { describe, expect, it } from 'vitest';
import { blackbodyLum, blackbodyXYZ, planckNu, xyzToLinearSrgb } from '../src/blackhole/blackbody';
import { deflectionFromInfinity, traceRay, W_FAR } from '../src/blackhole/geodesic';
import {
  B_CRIT, NT_PEAK, diskRedshift, escapeFraction, hoverAccel, ntFlux, schwarzschildRadiusM, shadowAngularRadius, tidalAccel, timeDilation,
} from '../src/blackhole/physics';
import { parseMassMsun } from '../src/blackhole/catalog';

describe('Schwarzschild radius from catalogue masses', () => {
  it('Sgr A* (4.297e6 Msun, GRAVITY 2022) ~ 1.27e7 km, Gaia BH3 (32.7 Msun) ~ 97 km', () => {
    expect(schwarzschildRadiusM(4.297e6) / 1e3).toBeCloseTo(1.269e7, -4);
    expect(schwarzschildRadiusM(32.7) / 1e3).toBeCloseTo(96.57, 1);
    expect(schwarzschildRadiusM(1) / 1e3).toBeCloseTo(2.9533, 3);
  });
  it('parses catalogue mass facts', () => {
    expect(parseMassMsun([4297000.0, 12000.0])).toBe(4297000);
    expect(parseMassMsun('>3.1 ± 0.1')).toBeCloseTo(3.1);
    expect(parseMassMsun('5.71–8.10 (8.40 +0.77 -0.70 if adopted i=63º)')).toBeCloseTo(6.905);
    expect(parseMassMsun('≤7.3')).toBeCloseTo(7.3);
    expect(parseMassMsun(null)).toBeNull();
  });
});

describe('light deflection (RK4 orbit equation)', () => {
  // weak field: alpha = 2 r_s / b + (15 pi / 16) (r_s / b)^2 + O(b^-3)  (e.g. Keeton & Petters 2005)
  for (const b of [60, 200, 1000]) {
    it(`b = ${b} r_s matches the weak-field series, leading term 2 r_s / b`, () => {
      const a = deflectionFromInfinity(b, { stepsPerTurn: 96 });
      const series = 2 / b + ((15 * Math.PI) / 16) / (b * b);
      expect(Math.abs(a - series) / series).toBeLessThan(3e-3);
      expect(Math.abs(a - 2 / b) / (2 / b)).toBeLessThan(0.05);
    });
  }
  it('critical impact parameter b_c = (3 sqrt 3 / 2) r_s separates capture from escape', () => {
    let lo = 2;
    let hi = 3;
    const opts = { stepsPerTurn: 256, maxSteps: 256 * 6 };
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (Number.isNaN(deflectionFromInfinity(m, opts))) lo = m;
      else hi = m;
    }
    expect(B_CRIT).toBeCloseTo(2.598076, 6);
    expect(Math.abs((lo + hi) / 2 - B_CRIT)).toBeLessThan(2e-5);
  });
  it('strong-deflection limit (Darwin 1959; Bozza 2002): alpha = -ln(b/b_c - 1) + ln(216(7 - 4 sqrt 3)) - pi', () => {
    for (const eps of [1e-3, 1e-4]) {
      const a = deflectionFromInfinity(B_CRIT * (1 + eps), { stepsPerTurn: 256, maxSteps: 256 * 6 });
      const darwin = -Math.log(eps) + Math.log(216 * (7 - 4 * Math.sqrt(3))) - Math.PI;
      expect(Math.abs(a - darwin)).toBeLessThan(0.02);
    }
  });
  it('the shader step count (96 per turn) agrees with a fine integration', () => {
    for (const b of [2.7, 3, 4, 8, 30]) {
      const fine = deflectionFromInfinity(b, { stepsPerTurn: 2048, maxSteps: 2048 * 4 });
      const shader = deflectionFromInfinity(b, { stepsPerTurn: 96 });
      expect(Math.abs(shader - fine)).toBeLessThan(2e-3);
    }
  });
});

describe('camera at finite radius', () => {
  it('flat limit: an outgoing ray from far away keeps its direction', () => {
    const psi = 0.7;
    const r = traceRay(1e6, Math.cos(psi), Math.sin(psi));
    expect(r.status).toBe('escaped');
    expect(r.phiInf).toBeCloseTo(psi, 5);
  });
  it('exit tail (from 10 r_s outward) agrees with integrating to 10^4 r_s', () => {
    let worst = 0;
    for (const r0 of [1.6, 4, 10, 30, 150]) {
      for (let k = 1; k < 40; k++) {
        const psi = (Math.PI * k) / 40;
        const fast = traceRay(r0, Math.cos(psi), Math.sin(psi));
        const ref = traceRay(r0, Math.cos(psi), Math.sin(psi), { uExit: 1e-4, stepsPerTurn: 2048, maxSteps: 2048 * 4, noFarShortcut: true });
        if (fast.status !== ref.status) continue; // rays grazing the photon sphere
        if (fast.status === 'escaped') worst = Math.max(worst, Math.abs(fast.phiInf - ref.phiInf));
      }
    }
    expect(worst).toBeLessThan(3e-5); // measured 1.3e-5 rad
  });
  it('far-ray shortcut agrees with RK4 near its threshold', () => {
    const r0 = 1000;
    // b just above 1 / W_FAR
    const b = 1.05 / W_FAR;
    const psi = Math.PI - Math.asin((b * Math.sqrt(1 - 1 / r0)) / r0);
    const fast = traceRay(r0, Math.cos(psi), Math.sin(psi));
    const slow = traceRay(r0, Math.cos(psi), Math.sin(psi), { noFarShortcut: true, stepsPerTurn: 512 });
    expect(fast.status).toBe('escaped');
    expect(Math.abs(fast.phiInf - slow.phiInf)).toBeLessThan(2e-4);
  });
  for (const x of [50, 10, 3, 1.5, 1.2]) {
    it(`shadow edge at r = ${x} r_s matches Synge's formula`, () => {
      // bisection in the angle from the hole direction for the capture boundary
      let lo = 0; // captured
      let hi = Math.PI; // escaped
      for (let i = 0; i < 40; i++) {
        const a = (lo + hi) / 2; // angle from the inward direction; psi = pi - a
        const r = traceRay(x, Math.cos(Math.PI - a), Math.sin(Math.PI - a), { stepsPerTurn: 256, maxSteps: 256 * 6 });
        if (r.status === 'captured') lo = a;
        else hi = a;
      }
      expect(Math.abs((lo + hi) / 2 - shadowAngularRadius(x))).toBeLessThan(2e-4);
    });
  }
  it('Einstein ring from 50 r_s: the ray that comes out straight behind the hole', () => {
    // find psi with phiInf = pi (source exactly behind); weak-field estimate theta_E ~ sqrt(2 / 50)
    let lo = 0.05;
    let hi = 0.6;
    for (let i = 0; i < 50; i++) {
      const a = (lo + hi) / 2;
      const r = traceRay(50, -Math.cos(a), Math.sin(a));
      if (r.status !== 'escaped' || r.phiInf > Math.PI) lo = a;
      else hi = a;
    }
    const thetaE = (lo + hi) / 2;
    expect(thetaE).toBeGreaterThan(Math.asin(shadowAngularRadius(50)) * 1.2);
    expect(Math.abs(thetaE - Math.sqrt(2 / 50)) / Math.sqrt(2 / 50)).toBeLessThan(0.15);
  });
});

describe('thin disk', () => {
  it('Novikov–Thorne flux: zero at the ISCO, peak near r = 4.77 r_s, r^-3 far out', () => {
    expect(ntFlux(3)).toBe(0);
    expect(NT_PEAK.x).toBeGreaterThan(4.6);
    expect(NT_PEAK.x).toBeLessThan(4.9);
    const k1 = ntFlux(2000) * 2000 ** 3;
    const k2 = ntFlux(4000) * 4000 ** 3;
    expect(Math.abs(k1 / k2 - 1)).toBeLessThan(0.03);
  });
  it('redshift factor: ISCO gas seen side-on from far away has g = sqrt(1 - 1.5/3) = 0.707', () => {
    expect(diskRedshift(3, 0, 1e9)).toBeCloseTo(Math.SQRT1_2, 6);
    // approaching side brighter than receding: g(+b) > g(-b), intensity ratio g^4
    const gA = diskRedshift(6, 6, 1e9);
    const gR = diskRedshift(6, -6, 1e9);
    expect(gA).toBeGreaterThan(1);
    expect(gR).toBeLessThan(0.75);
  });
  it('a disk ray traced face-on from far above lands at the radius its impact parameter implies', () => {
    // camera on the axis (n = e1), so the disk plane is crossed at phi = pi/2: A = 1, B = 0
    const r0 = 150;
    const psi = Math.PI - 0.04;
    const t = traceRay(r0, Math.cos(psi), Math.sin(psi), { disk: { A: 1, B: 0, rIn: 3, rOut: 30 } });
    expect(t.status).toBe('disk');
    expect(t.phiHit).toBeCloseTo(Math.PI / 2, 6);
    // flat-space estimate r0 tan(0.04) = 6.0; the ray bends toward the hole, so it lands closer in
    expect(t.rHit).toBeGreaterThan(5);
    expect(t.rHit).toBeLessThan(6.0);
  });
});

describe('disk image from the shader settings vs a fine reference', () => {
  it('80° view from 50 r_s: same pixels hit the disk, at the same radius (Luminet geometry)', () => {
    const r0 = 50;
    const inc = (80 * Math.PI) / 180;
    const n = [0, 0, 1];
    const e1 = [Math.sin(inc), 0, Math.cos(inc)];
    const fwd = e1.map((c) => -c);
    let up = [0, 0, 1].map((z, k) => z - fwd[2] * fwd[k]);
    const ul = Math.hypot(...up);
    up = up.map((c) => c / ul);
    const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
    const t = Math.tan((30 * Math.PI) / 360);
    let total = 0;
    let mismatch = 0;
    let worstR = 0;
    for (let j = 0; j < 60; j++) for (let i = 0; i < 90; i++) {
      const nx = ((i + 0.5) / 90) * 2 - 1;
      const ny = 1 - ((j + 0.5) / 60) * 2;
      const d0 = [0, 1, 2].map((k) => fwd[k] + right[k] * nx * t * 1.5 + up[k] * ny * t);
      const dl = Math.hypot(...d0);
      const d = d0.map((c) => c / dl);
      const cp = d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2];
      const tv = d.map((c, k) => c - cp * e1[k]);
      const sp = Math.hypot(...tv);
      const e2 = tv.map((c) => c / sp);
      const disk = { A: n[0] * e1[0] + n[1] * e1[1] + n[2] * e1[2], B: n[0] * e2[0] + n[1] * e2[1] + n[2] * e2[2], rIn: 3, rOut: 12 };
      const a = traceRay(r0, cp, sp, { disk });
      const b = traceRay(r0, cp, sp, { disk, uExit: 1e-4, stepsPerTurn: 1024, maxSteps: 4096 });
      total++;
      if (a.status !== b.status) mismatch++;
      else if (a.status === 'disk') worstR = Math.max(worstR, Math.abs(a.rHit - b.rHit));
    }
    // a few rays right on an edge (r_in, r_out, the photon ring) may land on either side
    expect(mismatch / total).toBeLessThan(0.003);
    expect(worstR).toBeLessThan(0.01);
  });
});

describe('blackbody colours', () => {
  it('redshifting a blackbody gives a blackbody: g^3 B_nu(nu/g, T) = B_nu(nu, gT)', () => {
    for (const g of [0.5, 1.3]) for (const nu of [3e14, 6e14]) {
      expect(g ** 3 * planckNu(nu / g, 6000)).toBeCloseTo(planckNu(nu, g * 6000), 20);
      expect(Math.abs(g ** 3 * planckNu(nu / g, 6000) / planckNu(nu, g * 6000) - 1)).toBeLessThan(1e-12);
    }
  });
  it('colour ordering: 3000 K red, 6500 K near white, 20000 K blue', () => {
    const norm = (T: number) => {
      const c = xyzToLinearSrgb(blackbodyXYZ(T));
      const m = Math.max(...c);
      return c.map((v) => v / m);
    };
    const r3 = norm(3000);
    expect(r3[0]).toBeGreaterThan(r3[1]);
    expect(r3[1]).toBeGreaterThan(r3[2]);
    const r65 = norm(6500);
    expect(Math.min(...r65)).toBeGreaterThan(0.85);
    const r20 = norm(20000);
    expect(r20[2]).toBeGreaterThan(r20[0]);
    expect(blackbodyLum(6500)).toBeCloseTo(1, 9);
    expect(blackbodyLum(10000)).toBeGreaterThan(blackbodyLum(5000));
  });
});

describe('shadow seen from Earth vs the EHT rings (catalogue mass and distance)', () => {
  // shadow diameter from far away = 2 b_c / D = sqrt(27) r_s / D. The EHT measures the emission
  // ring, which GRMHD models put a few % outside the shadow, so agreement within ~2 sigma is the test.
  const uas = (massMsun: number, distPc: number) => ((Math.sqrt(27) * schwarzschildRadiusM(massMsun)) / (distPc * 3.0856775814913673e16)) * (180 / Math.PI) * 3.6e9;
  it('Sgr A*: 4.297e6 Msun at 8277 pc -> 53.3 uas; EHT 2022 ring 51.8 +- 2.3 uas', () => {
    const d = uas(4.297e6, 8277);
    expect(d).toBeCloseTo(53.3, 1);
    expect(Math.abs(d - 51.8)).toBeLessThan(2 * 2.3);
  });
  it('M87*: 6.5e9 Msun at 16.8 Mpc -> 39.7 uas; EHT 2019 ring 42 +- 3 uas', () => {
    const d = uas(6.5e9, 16.8e6);
    expect(d).toBeCloseTo(39.7, 1);
    expect(Math.abs(d - 42)).toBeLessThan(2 * 3);
  });
});

describe('HUD quantities', () => {
  it('time dilation, escape speed, tidal stretch, hover thrust', () => {
    expect(timeDilation(1.5)).toBeCloseTo(Math.sqrt(1 / 3), 12);
    expect(escapeFraction(4)).toBeCloseTo(0.5, 12);
    // Gaia BH3 at 1.5 r_s: tidal over 2 m is ~6e5 g; Sgr A* at 1.5 r_s: far below 1 g
    const rs3 = schwarzschildRadiusM(32.7);
    expect(tidalAccel(rs3, 1.5 * rs3) / 9.80665).toBeGreaterThan(1e5);
    const rsA = schwarzschildRadiusM(4.297e6);
    expect(tidalAccel(rsA, 1.5 * rsA) / 9.80665).toBeLessThan(1e-4);
    expect(hoverAccel(rsA, rsA)).toBe(Infinity);
  });
});
