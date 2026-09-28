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
    if (this.current) this.current.unmount();
    clear(this.root);
    this.root.className = '';
    this.current = screen;
    await screen.mount(this.root);
  }

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
