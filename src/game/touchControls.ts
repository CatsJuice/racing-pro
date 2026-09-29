import { t } from '../i18n';
import { h, toast } from '../ui/dom';
import { screenAngle } from '../ui/device';
import type { Action, Input } from './input';

export type SteerMode = 'buttons' | 'tilt';

/** full lock at this much wheel-style rotation of the device */
const TILT_FULL = (28 * Math.PI) / 180;
const TILT_DEAD = (1.5 * Math.PI) / 180;

/** Tracks the pointers pressing an element and reports held on/off transitions. */
function bindHold(el: HTMLElement, fn: (on: boolean) => void) {
  const ids = new Set<number>();
  const sync = () => {
    el.classList.toggle('on', ids.size > 0);
    fn(ids.size > 0);
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    ids.add(e.pointerId);
    sync();
  });
  const up = (e: PointerEvent) => {
    if (ids.delete(e.pointerId)) sync();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}

/** On-screen driving controls for touch devices. */
export class TouchControls {
  el: HTMLElement;
  private steerPad: HTMLElement;
  private tiltEl: HTMLElement;
  private tiltDot: HTMLElement;
  private mode: SteerMode = 'buttons';

  constructor(private input: Input, opts: { manualGears: boolean; mode?: SteerMode; onPause: () => void }) {
    const hold = (cls: string, label: string, a: Action) => {
      const b = h('div', { class: `tc-btn ${cls}` }, label);
      bindHold(b, (on) => input.setHeld(a, on));
      return b;
    };
    const tap = (cls: string, label: string, fn: () => void) => {
      const b = h('div', { class: `tc-btn ${cls}` }, label);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('on'); fn(); });
      const off = () => b.classList.remove('on');
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
      return b;
    };

    // steering pad: one element so a thumb can slide from left to right without lifting
    const left = h('div', { class: 'tc-half' }, '◀');
    const right = h('div', { class: 'tc-half' }, '▶');
    this.steerPad = h('div', { class: 'tc-steer' }, left, right);
    const sides = new Map<number, -1 | 1>();
    const syncSteer = () => {
      const vals = [...sides.values()];
      const l = vals.includes(-1), r = vals.includes(1);
      left.classList.toggle('on', l);
      right.classList.toggle('on', r);
      input.setHeld('left', l);
      input.setHeld('right', r);
    };
    const sideOf = (e: PointerEvent) => {
      const b = this.steerPad.getBoundingClientRect();
      return e.clientX < b.left + b.width / 2 ? -1 : 1;
    };
    this.steerPad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { this.steerPad.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      sides.set(e.pointerId, sideOf(e));
      syncSteer();
    });
    this.steerPad.addEventListener('pointermove', (e) => {
      if (!sides.has(e.pointerId)) return;
      const s = sideOf(e);
      if (s !== sides.get(e.pointerId)) { sides.set(e.pointerId, s); syncSteer(); }
    });
    const release = (e: PointerEvent) => { if (sides.delete(e.pointerId)) syncSteer(); };
    this.steerPad.addEventListener('pointerup', release);
    this.steerPad.addEventListener('pointercancel', release);
    this.steerPad.addEventListener('lostpointercapture', release);

    this.tiltDot = h('div', { class: 'tc-tilt-dot' });
    this.tiltEl = h('div', { class: 'tc-tilt' }, h('div', { class: 'tc-tilt-track' }, this.tiltDot), h('small', null, `📱 ${t('touch.tilt')}`));

    const gears = opts.manualGears
      ? h('div', { class: 'tc-gears' }, tap('small', '▲', () => input.press('shiftUp')), tap('small', '▼', () => input.press('shiftDown')))
      : null;

    this.el = h('div', { class: 'touch-controls' },
      h('div', { class: 'tc-top' },
        tap('round', '⏸', opts.onPause),
        tap('round', '🎥', () => input.press('camera')),
        tap('round', '👻', () => input.press('ghost')),
        tap('round', '↺', () => input.press('reset')),
      ),
      h('div', { class: 'tc-left' }, this.steerPad, this.tiltEl),
      h('div', { class: 'tc-right' },
        h('div', { class: 'tc-col' }, hold('tc-rewind', '⏪', 'rewind'), hold('tc-hand', '🅿', 'hand')),
        gears,
        hold('tc-pedal tc-brake', '', 'down'),
        hold('tc-pedal tc-gas', '', 'up'),
      ),
    );
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    void this.setMode(opts.mode ?? 'buttons', true);
  }

  get steerMode() {
    return this.mode;
  }

  /** Must be called from a user gesture when switching to tilt (iOS permission prompt). */
  async setMode(mode: SteerMode, quiet = false): Promise<SteerMode> {
    window.removeEventListener('deviceorientation', this.onOrient);
    this.input.analogSteer = null;
    if (mode === 'tilt') {
      const DOE = (window as any).DeviceOrientationEvent;
      let ok = !!DOE;
      if (ok && typeof DOE.requestPermission === 'function') {
        try { ok = (await DOE.requestPermission()) === 'granted'; } catch { ok = false; }
      }
      if (!ok) {
        if (!quiet) toast(t('touch.tiltDenied'), 'bad');
        mode = 'buttons';
      } else {
        window.addEventListener('deviceorientation', this.onOrient);
      }
    }
    this.mode = mode;
    this.el.classList.toggle('tilt', mode === 'tilt');
    return mode;
  }

  /**
   * Wheel-style tilt: project gravity onto the screen plane and use its horizontal
   * component, which is independent of how far the phone is leaned back.
   */
  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    // gravity ("down") in device coordinates
    const dx = Math.cos(b) * Math.sin(g), dy = -Math.sin(b);
    const a = (screenAngle() * Math.PI) / 180;
    // screen-right axis expressed in device coordinates
    const gr = dx * Math.cos(a) - dy * Math.sin(a);
    const ang = Math.asin(Math.max(-1, Math.min(1, gr)));
    let s = 0;
    if (Math.abs(ang) > TILT_DEAD) s = Math.max(-1, Math.min(1, (Math.abs(ang) - TILT_DEAD) / (TILT_FULL - TILT_DEAD))) * Math.sign(ang);
    // device rolled counter-clockwise (left turn) tips gravity toward screen-left
    this.input.analogSteer = -s;
    this.tiltDot.style.left = `${50 + s * 46}%`;
  };

  dispose() {
    window.removeEventListener('deviceorientation', this.onOrient);
    this.input.analogSteer = null;
    this.el.remove();
  }
}
