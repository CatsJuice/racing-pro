export interface Controls {
  throttle: number;
  brake: number;
  steer: number; // + left
  handbrake: number;
  shiftUp: boolean;
  shiftDown: boolean;
}

type Action = 'up' | 'down' | 'left' | 'right' | 'hand' | 'shiftUp' | 'shiftDown' | 'reset' | 'camera' | 'pause' | 'ghost' | 'mute';

const KEYMAP: Record<string, Action> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'hand',
  KeyE: 'shiftUp', ShiftLeft: 'shiftUp', ShiftRight: 'shiftUp',
  KeyQ: 'shiftDown', ControlLeft: 'shiftDown', ControlRight: 'shiftDown',
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause', KeyP: 'pause',
  KeyG: 'ghost',
  KeyM: 'mute',
};

export class Input {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private throttle = 0;
  private brake = 0;
  private padPrev: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    if (!this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
  };

  private onUp = (e: KeyboardEvent) => {
    const a = KEYMAP[e.code];
    if (a) this.held.delete(a);
  };

  private onBlur = () => this.held.clear();

  /** returns true once per key press */
  consume(a: Action) {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  read(dt: number): Controls {
    const pad = navigator.getGamepads ? Array.from(navigator.getGamepads()).find((p) => p && p.connected) : null;
    let steer = (this.held.has('left') ? 1 : 0) - (this.held.has('right') ? 1 : 0);
    const up = this.held.has('up'), down = this.held.has('down');
    // keyboard pedals ramp for smoother inputs
    this.throttle += ((up ? 1 : 0) - this.throttle) * Math.min(1, dt * (up ? 9 : 14));
    this.brake += ((down ? 1 : 0) - this.brake) * Math.min(1, dt * (down ? 12 : 16));
    let throttle = this.throttle, brake = this.brake, hand = this.held.has('hand') ? 1 : 0;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.08) steer = -Math.sign(ax) * Math.pow((Math.abs(ax) - 0.08) / 0.92, 1.4);
      const rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.02) throttle = rt;
      if (lt > 0.02) brake = lt;
      if (pad.buttons[0]?.pressed) hand = 1;
      const edges: [number, Action][] = [[5, 'shiftUp'], [4, 'shiftDown'], [3, 'reset'], [9, 'pause'], [2, 'camera']];
      for (const [b, a] of edges) {
        const p = !!pad.buttons[b]?.pressed;
        if (p && !this.padPrev[b]) this.pressed.add(a);
        this.padPrev[b] = p;
      }
    }
    return {
      throttle: throttle < 0.01 ? 0 : throttle,
      brake: brake < 0.01 ? 0 : brake,
      steer,
      handbrake: hand,
      shiftUp: this.consume('shiftUp'),
      shiftDown: this.consume('shiftDown'),
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
