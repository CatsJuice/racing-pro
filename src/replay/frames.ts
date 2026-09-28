import { F, FRAME_STRIDE } from '../core/storage';

export const RECORD_HZ = 30;

export class FrameRecorder {
  private data: number[] = [];

  clear() {
    this.data.length = 0;
  }

  push(values: number[]) {
    for (let i = 0; i < FRAME_STRIDE; i++) this.data.push(values[i] ?? 0);
  }

  truncate(frames: number) {
    this.data.length = Math.min(this.data.length, frames * FRAME_STRIDE);
  }

  get count() {
    return this.data.length / FRAME_STRIDE;
  }

  toArray() {
    return new Float32Array(this.data);
  }
}

export function frameCount(frames: Float32Array) {
  return Math.floor(frames.length / FRAME_STRIDE);
}

export function get(frames: Float32Array, i: number, field: number) {
  return frames[i * FRAME_STRIDE + field];
}

/** index of the last frame with t <= time */
export function indexAtTime(frames: Float32Array, time: number) {
  let lo = 0, hi = frameCount(frames) - 1;
  if (hi < 0) return 0;
  if (time <= frames[F.t]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid * FRAME_STRIDE + F.t] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Interpolated frame at time t into `out` (length FRAME_STRIDE). */
export function sampleAt(frames: Float32Array, time: number, out: Float32Array | number[]) {
  const n = frameCount(frames);
  const i = indexAtTime(frames, time);
  const j = Math.min(n - 1, i + 1);
  const ta = frames[i * FRAME_STRIDE + F.t], tb = frames[j * FRAME_STRIDE + F.t];
  const k = tb > ta ? Math.max(0, Math.min(1, (time - ta) / (tb - ta))) : 0;
  for (let f = 0; f < FRAME_STRIDE; f++) {
    const a = frames[i * FRAME_STRIDE + f], b = frames[j * FRAME_STRIDE + f];
    out[f] = f === F.heading ? lerpAngle(a, b, k) : f === F.gear ? (k < 0.5 ? a : b) : a + (b - a) * k;
  }
  return out;
}

/** Time at which the lap reached distance s (for live delta). Assumes s mostly increasing. */
export function timeAtDistance(frames: Float32Array, s: number, hint = 0): { t: number; index: number } {
  const n = frameCount(frames);
  let i = Math.max(0, Math.min(n - 2, hint));
  // walk forward/back from the hint
  while (i < n - 2 && frames[(i + 1) * FRAME_STRIDE + F.s] < s) i++;
  while (i > 0 && frames[i * FRAME_STRIDE + F.s] > s) i--;
  const sa = frames[i * FRAME_STRIDE + F.s], sb = frames[(i + 1) * FRAME_STRIDE + F.s];
  const ta = frames[i * FRAME_STRIDE + F.t], tb = frames[(i + 1) * FRAME_STRIDE + F.t];
  const k = sb > sa ? Math.max(0, Math.min(1, (s - sa) / (sb - sa))) : 0;
  return { t: ta + (tb - ta) * k, index: i };
}

/** Colour ramp for speed lines: slow = blue, fast = red. */
export function speedColor(k: number): [number, number, number] {
  k = Math.max(0, Math.min(1, k));
  const stops: [number, number, number, number][] = [
    [0, 0.2, 0.3, 0.95],
    [0.25, 0.1, 0.75, 0.95],
    [0.5, 0.25, 0.85, 0.3],
    [0.75, 1.0, 0.82, 0.15],
    [1, 0.95, 0.15, 0.15],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (k <= b[0]) {
      const t = (k - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [0.95, 0.15, 0.15];
}

export function cssColor(c: [number, number, number]) {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}
