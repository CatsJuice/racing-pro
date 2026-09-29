/** Device / layout helpers shared by screens that adapt to phones and tablets. */

export const isTouch =
  typeof window !== 'undefined' &&
  (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);

/** phone-sized viewport (either orientation) */
export function isCompact() {
  return Math.min(window.innerWidth, window.innerHeight) < 560 || window.innerWidth < 760;
}

export function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

/** screen rotation in degrees (0, 90, 180, 270) */
export function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as any).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

export function initDevice() {
  const cl = document.documentElement.classList;
  cl.toggle('touch', isTouch);
  const sync = () => {
    cl.toggle('compact', isCompact());
    cl.toggle('portrait', isPortrait());
    // iOS: 100vh includes the collapsing toolbar, expose the real height
    document.documentElement.style.setProperty('--vh', `${window.innerHeight / 100}px`);
  };
  sync();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', () => setTimeout(sync, 200));
  if (isTouch) {
    // no pinch-zoom / double-tap zoom on the game surface (iOS ignores user-scalable)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  }
}

/** Best effort: fullscreen + landscape lock (Android Chrome; silently ignored elsewhere). */
export async function enterLandscape() {
  if (!isTouch) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await (screen.orientation as any)?.lock?.('landscape');
  } catch { /* not supported */ }
}

export function exitLandscape() {
  try { (screen.orientation as any)?.unlock?.(); } catch { /* ignore */ }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
