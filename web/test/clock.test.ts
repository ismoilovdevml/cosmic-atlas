import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/solar/clock';

describe('simulation clock', () => {
  it('follows real time by default, then speeds up, pauses and resets without jumps', () => {
    let real = 1_000_000;
    const c = new SimClock(() => real);
    expect(c.now()).toBe(1_000_000);
    expect(c.live).toBe(true);
    real += 1000;
    expect(c.now()).toBe(1_001_000);
    c.setSpeed(1e4);
    expect(c.now()).toBe(1_001_000); // no jump at the switch
    real += 1000;
    expect(c.now()).toBe(1_001_000 + 1e7);
    c.setPaused(true);
    const held = c.now();
    real += 5000;
    expect(c.now()).toBe(held);
    expect(c.rate).toBe(0);
    c.setPaused(false);
    real += 1;
    expect(c.now()).toBe(held + 1e4);
    c.resetToNow();
    expect(c.now()).toBe(real);
    expect(c.speed).toBe(1);
  });
});
