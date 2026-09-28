import { TrackGeometry, splinePolyline, type TrackData, type Vec2 } from './track';

export interface View2D {
  scale: number; // px per metre
  ox: number; // screen offset
  oy: number;
  toScreen(x: number, z: number): [number, number];
  toWorld(px: number, py: number): Vec2;
}

export function makeView(scale: number, ox: number, oy: number): View2D {
  return {
    scale, ox, oy,
    toScreen: (x, z) => [ox + x * scale, oy + z * scale],
    toWorld: (px, py) => ({ x: (px - ox) / scale, z: (py - oy) / scale }),
  };
}

export function fitView(points: Vec2[], w: number, h: number, pad = 16): View2D {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const sw = Math.max(1, maxX - minX), sh = Math.max(1, maxZ - minZ);
  const scale = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
  const ox = w / 2 - ((minX + maxX) / 2) * scale;
  const oy = h / 2 - ((minZ + maxZ) / 2) * scale;
  return makeView(scale, ox, oy);
}

export interface DrawOpts {
  roadColor?: string;
  edgeColor?: string;
  minWidthPx?: number;
  startLine?: boolean;
  arrows?: boolean;
  outline?: boolean;
}

export function drawTrack(ctx: CanvasRenderingContext2D, data: TrackData, view: View2D, opts: DrawOpts = {}) {
  if (data.points.length < 3) return;
  const line = splinePolyline(data.points, 20);
  const w = Math.max(opts.minWidthPx ?? 3, data.width * view.scale);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    line.forEach((p, i) => {
      const [x, y] = view.toScreen(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  if (opts.outline !== false) {
    path();
    ctx.strokeStyle = opts.edgeColor ?? '#1b1d2a';
    ctx.lineWidth = w + Math.max(2, w * 0.25);
    ctx.stroke();
  }
  path();
  ctx.strokeStyle = opts.roadColor ?? '#5b5f68';
  ctx.lineWidth = w;
  ctx.stroke();
  if (opts.startLine !== false) {
    const g = new TrackGeometry(data);
    const c = g.samples[0];
    const half = Math.max(w / 2 + 2, data.width * 0.5 * view.scale + 2);
    const [x, y] = view.toScreen(c.x, c.z);
    const nx = c.nx, ny = c.nz;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(3, 2.5 * view.scale);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x - nx * half, y - ny * half);
    ctx.lineTo(x + nx * half, y + ny * half);
    ctx.stroke();
    ctx.strokeStyle = '#111';
    ctx.setLineDash([Math.max(2, view.scale * 1.5), Math.max(2, view.scale * 1.5)]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (opts.arrows) {
      ctx.fillStyle = '#ffd23f';
      const step = Math.max(60, g.length / 14);
      for (let s = step * 0.5; s < g.length; s += step) {
        const p = g.pointAt(s);
        const [ax, ay] = view.toScreen(p.x, p.z);
        const sz = Math.max(5, Math.min(12, w * 0.45));
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(Math.atan2(p.tz, p.tx));
        ctx.beginPath();
        ctx.moveTo(sz, 0);
        ctx.lineTo(-sz * 0.7, sz * 0.7);
        ctx.lineTo(-sz * 0.3, 0);
        ctx.lineTo(-sz * 0.7, -sz * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

/** Renders a thumbnail into a new canvas. */
export function trackThumb(data: TrackData, w = 220, h = 140, bg = '#8fd765'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (data.points.length >= 3) {
    const view = fitView(splinePolyline(data.points, 8), w, h, 14);
    drawTrack(ctx, data, view, { minWidthPx: 4, arrows: false });
  }
  return cv;
}
