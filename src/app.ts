import { clear } from './ui/dom';

export interface Screen {
  mount(root: HTMLElement): void | Promise<void>;
  update?(dt: number, time: number): void;
  unmount(): void;
}

class App {
  root = document.getElementById('ui') as HTMLElement;
  current: Screen | null = null;
  private last = performance.now();
  private time = 0;

  async go(screen: Screen) {
    const hadScreen = !!this.current;
    if (this.current) this.current.unmount();
    clear(this.root);
    this.root.className = '';
    this.current = screen;
    // a short veil hides the frame where the old 3D scene is still on the canvas
    if (hadScreen) {
      const veil = document.createElement('div');
      veil.className = 'fade-veil';
      document.body.append(veil);
      setTimeout(() => veil.remove(), 500);
    }
    await screen.mount(this.root);
    this.root.classList.add('ui-enter');
    clearTimeout(this.enterTimer);
    this.enterTimer = window.setTimeout(() => this.root.classList.remove('ui-enter'), 700);
  }

  private enterTimer = 0;

  start() {
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.time += dt;
      this.current?.update?.(dt, this.time);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

export const app = new App();
