/** Compact time control for the Solar System: date readout, pause/play, ×1 / ×10⁴ / ×10⁶, Now. */

import { SPEEDS, type SimClock } from './clock';
import { tr } from './strings';

const SPEED_LABEL: Record<number, string> = { 1: '×1', 1e4: '×10⁴', 1e6: '×10⁶' };

export class TimeBar {
  readonly el: HTMLElement;
  private out: HTMLOutputElement;
  private play: HTMLButtonElement;
  private speeds: HTMLButtonElement[] = [];
  private nowBtn: HTMLButtonElement;
  private shown = '';

  constructor(private clock: SimClock) {
    const el = document.createElement('div');
    el.id = 'timectl';
    el.className = 'panel timectl';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', tr('time.label'));
    el.hidden = true;
    el.innerHTML = `
      <output class="t-date" aria-live="off"></output>
      <button type="button" class="icon-btn t-play" aria-pressed="false"></button>
      <span class="t-speeds" role="radiogroup" aria-label="${tr('time.speed')}"></span>
      <button type="button" class="t-now"></button>`;
    this.out = el.querySelector('output')!;
    this.play = el.querySelector('.t-play')!;
    this.nowBtn = el.querySelector('.t-now')!;
    this.nowBtn.textContent = tr('time.now');
    const sp = el.querySelector('.t-speeds')!;
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = SPEED_LABEL[s];
      b.addEventListener('click', () => {
        clock.setSpeed(s);
        if (clock.paused) clock.setPaused(false);
      });
      sp.appendChild(b);
      this.speeds.push(b);
    }
    this.play.addEventListener('click', () => clock.setPaused(!clock.paused));
    this.nowBtn.addEventListener('click', () => clock.resetToNow());
    this.el = el;
    this.sync();
    const prev = clock.onChange;
    clock.onChange = () => {
      prev();
      this.sync();
    };
  }

  private sync() {
    const c = this.clock;
    this.play.setAttribute('aria-pressed', String(c.paused));
    const label = c.paused ? tr('time.play') : tr('time.pause');
    this.play.setAttribute('aria-label', label);
    this.play.title = label;
    this.play.innerHTML = c.paused
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
    SPEEDS.forEach((s, i) => this.speeds[i].setAttribute('aria-checked', String(c.speed === s)));
    this.nowBtn.setAttribute('aria-pressed', String(c.live));
    this.tick();
  }

  /** refresh the date readout (cheap; only touches the DOM when the text changes) */
  tick() {
    const d = new Date(this.clock.now());
    const iso = d.toISOString();
    const showSec = this.clock.rate <= 1;
    const text = `${iso.slice(0, 10)} ${iso.slice(11, showSec ? 19 : 16)} ${tr('time.utc')}`;
    if (text !== this.shown) {
      this.shown = text;
      this.out.textContent = text;
    }
    this.nowBtn.setAttribute('aria-pressed', String(this.clock.live));
  }
}
