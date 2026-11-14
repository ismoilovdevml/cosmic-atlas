/**
 * Simulation clock for the Solar System: real time by default, pausable, with speed-ups.
 * sim(t) = simBase + (real(t) - realBase) * rate, re-based on every change so the shown date
 * never jumps when the rate changes.
 */

/** ×1 (seconds) … 1 Julian year per second */
export const SPEEDS = [1, 1e4, 1e6, 31_557_600] as const;

export class SimClock {
  private simBase: number;
  private realBase: number;
  /** current speed multiplier (kept while paused) */
  speed = 1;
  paused = false;
  onChange: () => void = () => {};

  constructor(private realNow: () => number = () => Date.now()) {
    this.simBase = this.realNow();
    this.realBase = this.simBase;
  }

  /** simulation time, ms since 1970 (UTC) */
  now(): number {
    if (this.paused) return this.simBase;
    return this.simBase + (this.realNow() - this.realBase) * this.speed;
  }

  get rate(): number {
    return this.paused ? 0 : this.speed;
  }

  /** true while the shown time follows the wall clock */
  get live(): boolean {
    return !this.paused && this.speed === 1 && Math.abs(this.now() - this.realNow()) < 2000;
  }

  private rebase() {
    this.simBase = this.now();
    this.realBase = this.realNow();
  }

  setSpeed(s: number) {
    this.rebase();
    this.speed = s;
    this.onChange();
  }

  setPaused(p: boolean) {
    this.rebase();
    this.paused = p;
    this.onChange();
  }

  /** jump to an absolute simulation time (ms) */
  set(ms: number) {
    this.simBase = ms;
    this.realBase = this.realNow();
    this.onChange();
  }

  /** back to real time, ×1, running */
  resetToNow() {
    this.simBase = this.realNow();
    this.realBase = this.simBase;
    this.speed = 1;
    this.paused = false;
    this.onChange();
  }
}
