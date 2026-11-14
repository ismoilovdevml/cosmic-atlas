/**
 * Time control, two rows:
 *   Solar System: date readout, pause/play, ×1 / ×10⁴ / ×10⁶ / 1 yr per second, Now (clock.ts)
 *   Stars:        log slider −1 Myr … Now … +1 Myr (epoch.ts), readout, Now, and the honesty note
 * Each row shows only where it means something (main.ts decides); the bar hides when both are off.
 */

import { SPEEDS, type SimClock } from './clock';
import { EPOCH_TICKS, SLIDER_MAX, epochParts, myrToSlider, sliderToMyr, type StarEpoch } from './epoch';
import { t } from '../i18n';
import { tr } from './strings';

const SPEED_LABEL: Record<number, string> = { 1: '×1', 1e4: '×10⁴', 1e6: '×10⁶' };
const speedLabel = (s: number) => SPEED_LABEL[s] ?? tr('time.yearPerSec');

/** "+12.3 kyr", "−1 Myr", "now" in the current language */
export function formatEpoch(myr: number): string {
  const p = epochParts(myr);
  if (p.sign === 0) return t('time.epoch.now');
  return `${p.sign > 0 ? '+' : '−'}${t(`time.epoch.${p.unit}`, { n: p.value })}`;
}

export class TimeBar {
  readonly el: HTMLElement;
  private solarRow: HTMLElement;
  private starRow: HTMLElement;
  private note: HTMLElement;
  private out: HTMLOutputElement;
  private play: HTMLButtonElement;
  private speeds: HTMLButtonElement[] = [];
  private nowBtn: HTMLButtonElement;
  private slider: HTMLInputElement;
  private epochOut: HTMLOutputElement;
  private starNow: HTMLButtonElement;
  private ticks: HTMLElement;
  private shown = '';
  private solarOn = false;
  private starsOn = false;

  constructor(private clock: SimClock, private epoch: StarEpoch) {
    const el = document.createElement('div');
    el.id = 'timectl';
    el.className = 'panel timectl';
    el.setAttribute('role', 'group');
    el.hidden = true;
    el.innerHTML = `
      <div class="t-row t-solar" role="group">
        <output class="t-date" aria-live="off"></output>
        <button type="button" class="icon-btn t-play" aria-pressed="false"></button>
        <span class="t-speeds" role="radiogroup"></span>
        <button type="button" class="t-now t-solar-now"></button>
      </div>
      <div class="t-row t-stars" role="group">
        <span class="t-tag"></span>
        <span class="t-track">
          <input type="range" class="t-epoch-range" min="${-SLIDER_MAX}" max="${SLIDER_MAX}" step="1" value="0" />
          <span class="t-ticks" aria-hidden="true"></span>
        </span>
        <output class="t-epoch" aria-live="polite"></output>
        <button type="button" class="t-now t-star-now"></button>
      </div>
      <p class="t-note fine"></p>`;
    this.solarRow = el.querySelector('.t-solar')!;
    this.starRow = el.querySelector('.t-stars')!;
    this.note = el.querySelector('.t-note')!;
    this.out = el.querySelector('.t-date')!;
    this.play = el.querySelector('.t-play')!;
    this.nowBtn = el.querySelector('.t-solar-now')!;
    this.slider = el.querySelector('.t-epoch-range')!;
    this.epochOut = el.querySelector('.t-epoch')!;
    this.starNow = el.querySelector('.t-star-now')!;
    this.ticks = el.querySelector('.t-ticks')!;
    this.solarRow.hidden = this.starRow.hidden = this.note.hidden = true; // setRows() turns them on
    const sp = el.querySelector('.t-speeds')!;
    for (const s of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.speed = String(s);
      b.addEventListener('click', () => {
        clock.setSpeed(s);
        if (clock.paused) clock.setPaused(false);
      });
      sp.appendChild(b);
      this.speeds.push(b);
    }
    this.play.addEventListener('click', () => clock.setPaused(!clock.paused));
    this.nowBtn.addEventListener('click', () => clock.resetToNow());
    this.slider.addEventListener('input', () => epoch.set(sliderToMyr(+this.slider.value)));
    this.starNow.addEventListener('click', () => epoch.set(0));
    this.el = el;
    // the right-hand panels (info card, stats) stop above this bar: style.css reads --timectl-h
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        document.documentElement.style.setProperty('--timectl-h', `${el.offsetHeight}px`);
      }).observe(el);
    }
    this.relabel();
    const prev = clock.onChange;
    clock.onChange = () => {
      prev();
      this.sync();
    };
    epoch.onChange(() => this.syncEpoch());
  }

  /** (re)write every language-dependent string */
  relabel() {
    const el = this.el;
    el.setAttribute('aria-label', tr('time.label'));
    this.solarRow.setAttribute('aria-label', tr('layer.solar'));
    this.starRow.setAttribute('aria-label', t('time.stars'));
    el.querySelector('.t-speeds')!.setAttribute('aria-label', tr('time.speed'));
    this.speeds.forEach((b) => (b.textContent = speedLabel(+b.dataset.speed!)));
    this.nowBtn.textContent = tr('time.now');
    this.starNow.textContent = tr('time.now');
    this.starNow.setAttribute('aria-label', t('time.epoch.reset'));
    el.querySelector('.t-tag')!.textContent = t('time.stars');
    this.slider.setAttribute('aria-label', t('time.epoch.label'));
    this.ticks.textContent = '';
    for (const yr of EPOCH_TICKS) {
      if (Math.abs(yr) === 1e3 || Math.abs(yr) === 1e5) continue; // labels every 2 decades; the track itself is uniform per decade
      const s = document.createElement('span');
      s.style.left = `${((myrToSlider(yr / 1e6) + SLIDER_MAX) / (2 * SLIDER_MAX)) * 100}%`;
      s.textContent = yr === 0 ? t('time.epoch.now') : formatEpoch(yr / 1e6);
      this.ticks.appendChild(s);
    }
    this.shown = '';
    this.sync();
    this.syncEpoch();
  }

  /** which rows make sense at this view (Solar System near the Sun; stars when a layer can move) */
  setRows(solar: boolean, stars: boolean) {
    if (solar !== this.solarOn) this.solarRow.hidden = !(this.solarOn = solar);
    // the star row stays while the epoch is off "now", so it can always be brought back
    const st = stars || this.epoch.active;
    if (st !== this.starsOn) {
      this.starRow.hidden = !(this.starsOn = st);
      this.note.hidden = !st;
    }
    const show = this.solarOn || this.starsOn;
    if (this.el.hidden === show) this.el.hidden = !show;
    if (this.solarOn) this.tick();
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

  private syncEpoch() {
    const m = this.epoch.myr;
    const p = myrToSlider(m);
    // keep the thumb where the user dragged it inside the dead zone
    if (Math.abs(+this.slider.value - p) > 0.5 && !(m === 0 && sliderToMyr(+this.slider.value) === 0)) this.slider.value = String(Math.round(p));
    const text = formatEpoch(m);
    this.epochOut.textContent = text;
    this.slider.setAttribute('aria-valuetext', text);
    this.starNow.setAttribute('aria-pressed', String(m === 0));
    this.note.textContent = m === 0 ? t('time.starsHint') : t('time.starsNote');
    this.el.classList.toggle('t-moved', m !== 0);
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
