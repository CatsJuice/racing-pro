import { REAL_TRACKS } from './realTracks';

export interface Vec2 {
  x: number;
  z: number;
}

export interface TrackData {
  id: string;
  name: string;
  points: Vec2[]; // closed loop of control points; points[0] is the start line
  width: number; // m
  builtin?: boolean;
  updated?: number;
}

export interface TrackSample {
  x: number;
  z: number;
  tx: number; // unit tangent
  tz: number;
  nx: number; // unit normal pointing left of travel
  nz: number;
  s: number; // distance from start
  curv: number; // signed curvature (+ = turning left)
}

export interface TrackProjection {
  index: number;
  s: number;
  lateral: number; // + = left of centre line
  dist: number;
}

const SAMPLE_STEP = 1.0;

/** centripetal Catmull-Rom point for closed loop */
function catmull(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const alpha = 0.5;
  const tj = (a: Vec2, b: Vec2, ti: number) => ti + Math.pow(Math.hypot(b.x - a.x, b.z - a.z) || 1e-4, alpha);
  const t0 = 0;
  const t1 = tj(p0, p1, t0);
  const t2 = tj(p1, p2, t1);
  const t3 = tj(p2, p3, t2);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
    const k = (tt - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  };
  const A1 = lerp(p0, p1, t0, t1);
  const A2 = lerp(p1, p2, t1, t2);
  const A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2);
  const B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

export function splinePolyline(points: Vec2[], perSeg = 24): Vec2[] {
  const n = points.length;
  const out: Vec2[] = [];
  if (n < 3) return points.slice();
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let k = 0; k < perSeg; k++) out.push(catmull(p0, p1, p2, p3, k / perSeg));
  }
  return out;
}

export class TrackGeometry {
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly width: number;
  readonly bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };

  constructor(readonly data: TrackData) {
    this.width = data.width;
    const dense = splinePolyline(data.points, 40);
    // cumulative length of dense polyline
    const cum: number[] = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const total = cum[cum.length - 1];
    const count = Math.max(8, Math.round(total / SAMPLE_STEP));
    this.length = total;
    let j = 0;
    for (let i = 0; i < count; i++) {
      const s = (i / count) * total;
      while (j < dense.length - 1 && cum[j + 1] < s) j++;
      const a = dense[j], b = dense[(j + 1) % dense.length];
      const k = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      this.samples.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: 0, tz: 0, nx: 0, nz: 0, s, curv: 0 });
    }
    const N = this.samples.length;
    for (let i = 0; i < N; i++) {
      const p = this.samples[(i - 1 + N) % N], q = this.samples[(i + 1) % N], c = this.samples[i];
      let tx = q.x - p.x, tz = q.z - p.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      c.tx = tx; c.tz = tz;
      // left normal: forward (tx,tz) with Y up -> left = (tz, -tx)  (three.js: forward +Z => left +X)
      c.nx = tz; c.nz = -tx;
      const b = this.bounds;
      b.minX = Math.min(b.minX, c.x); b.maxX = Math.max(b.maxX, c.x);
      b.minZ = Math.min(b.minZ, c.z); b.maxZ = Math.max(b.maxZ, c.z);
    }
    // curvature from heading change, smoothed
    const raw: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = this.samples[(i - 2 + N) % N], b = this.samples[(i + 2) % N];
      const ha = Math.atan2(a.tx, a.tz), hb = Math.atan2(b.tx, b.tz);
      let d = hb - ha;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      raw.push(d / (4 * (total / count)));
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -4; k <= 4; k++) acc += raw[(i + k + N) % N];
      this.samples[i].curv = acc / 9;
    }
  }

  get count() {
    return this.samples.length;
  }

  at(i: number): TrackSample {
    const N = this.samples.length;
    return this.samples[((i % N) + N) % N];
  }

  /** Interpolated centre-line point at distance s. */
  pointAt(s: number) {
    const N = this.samples.length;
    const f = ((s % this.length) + this.length) % this.length / this.length * N;
    const i = Math.floor(f), k = f - i;
    const a = this.at(i), b = this.at(i + 1);
    return {
      x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k,
      tx: a.tx + (b.tx - a.tx) * k, tz: a.tz + (b.tz - a.tz) * k,
      nx: a.nx + (b.nx - a.nx) * k, nz: a.nz + (b.nz - a.nz) * k,
    };
  }

  /** Project a world point on the centre line. `hint` = previous index (-1 = global search). */
  project(x: number, z: number, hint = -1, window = 40): TrackProjection {
    const N = this.samples.length;
    let best = -1, bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const c = this.samples[i];
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      for (let k = -window; k <= window; k++) {
        const i = (hint + k + N) % N;
        const c = this.samples[i];
        const d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    const c = this.samples[best];
    const dx = x - c.x, dz = z - c.z;
    const along = dx * c.tx + dz * c.tz;
    const lateral = dx * c.nx + dz * c.nz;
    let s = c.s + along;
    s = ((s % this.length) + this.length) % this.length;
    return { index: best, s, lateral, dist: Math.sqrt(bestD) };
  }

  private grid: Map<number, number[]> | null = null;
  private static CELL = 24;

  private cellKey(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** Uniform grid over the samples for fast proximity queries. */
  private buildGrid() {
    const g = new Map<number, number[]>();
    const C = TrackGeometry.CELL;
    this.samples.forEach((c, i) => {
      const k = this.cellKey(Math.floor(c.x / C), Math.floor(c.z / C));
      let arr = g.get(k);
      if (!arr) g.set(k, (arr = []));
      arr.push(i);
    });
    this.grid = g;
    return g;
  }

  /** Indices of samples within `r` metres of (x, z). */
  samplesNear(x: number, z: number, r: number): number[] {
    const g = this.grid ?? this.buildGrid();
    const C = TrackGeometry.CELL;
    const out: number[] = [];
    const r2 = r * r;
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) {
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        const arr = g.get(this.cellKey(cx, cz));
        if (!arr) continue;
        for (const i of arr) {
          const c = this.samples[i];
          if ((c.x - x) ** 2 + (c.z - z) ** 2 <= r2) out.push(i);
        }
      }
    }
    return out;
  }

  /** Minimum distance from point to the centre line. */
  distanceTo(x: number, z: number): number {
    // search growing radii through the grid, fall back to a coarse global scan
    for (const r of [30, 90, 240]) {
      const near = this.samplesNear(x, z, r);
      if (near.length) {
        let best = Infinity;
        for (const i of near) best = Math.min(best, (this.samples[i].x - x) ** 2 + (this.samples[i].z - z) ** 2);
        return Math.sqrt(best);
      }
    }
    let best = Infinity;
    for (let i = 0; i < this.samples.length; i += 3) {
      const c = this.samples[i];
      best = Math.min(best, (c.x - x) ** 2 + (c.z - z) ** 2);
    }
    return Math.sqrt(best);
  }

  startPose() {
    const c = this.samples[0];
    return { x: c.x, z: c.z, heading: Math.atan2(c.tx, c.tz) };
  }
}

export interface TrackIssue {
  level: 'error' | 'warn';
  msg: string;
}

export function validateTrack(data: TrackData): TrackIssue[] {
  const issues: TrackIssue[] = [];
  if (data.points.length < 4) {
    issues.push({ level: 'error', msg: '至少需要 4 个控制点才能形成闭合赛道' });
    return issues;
  }
  const g = new TrackGeometry(data);
  if (g.length < 300) issues.push({ level: 'error', msg: `赛道太短（${g.length.toFixed(0)}m），至少需要 300m` });
  // self intersection (coarse)
  const S = g.samples;
  const step = 4;
  let crossings = 0;
  const seg = (i: number) => [S[i], S[(i + step) % S.length]] as const;
  for (let i = 0; i < S.length && crossings === 0; i += step) {
    const [a, b] = seg(i);
    for (let j = i + step * 3; j < S.length; j += step) {
      if (i === 0 && j >= S.length - step * 2) continue;
      const [c, d] = seg(j);
      if (segIntersect(a, b, c, d)) { crossings++; break; }
    }
  }
  if (crossings) issues.push({ level: 'warn', msg: '赛道存在交叉（平面交叉，没有立交桥）' });
  // too close parallel sections
  let close = false;
  for (let i = 0; i < S.length && !close; i += 6) {
    for (let j = 0; j < S.length; j += 6) {
      const gap = Math.abs(S[i].s - S[j].s);
      const along = Math.min(gap, g.length - gap);
      if (along < g.width * 4) continue;
      if (Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z) < g.width * 1.05) { close = true; break; }
    }
  }
  if (close && !crossings) issues.push({ level: 'warn', msg: '有两段赛道挨得太近，路面会重叠' });
  const minR = 1 / Math.max(1e-6, Math.max(...S.map((s) => Math.abs(s.curv))));
  if (minR < g.width * 0.6) issues.push({ level: 'warn', msg: `最小弯道半径 ${minR.toFixed(1)}m，过急的弯会导致路面折叠` });
  return issues;
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Signed area; > 0 means counter-clockwise in (x,z) as drawn on a canvas with z down. */
export function polygonArea(points: Vec2[]) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Resample a free-hand stroke into evenly spaced control points. */
export function simplifyStroke(stroke: Vec2[], spacing = 28): Vec2[] {
  if (stroke.length < 2) return stroke.slice();
  const pts = stroke.slice();
  // close the stroke
  pts.push({ ...pts[0] });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1];
  const n = Math.max(4, Math.round(total / spacing));
  const out: Vec2[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const k = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * k, z: pts[j].z + (pts[j + 1].z - pts[j].z) * k });
  }
  // light smoothing
  const sm = out.map((p, i) => {
    const a = out[(i - 1 + n) % n], b = out[(i + 1) % n];
    return { x: p.x * 0.5 + (a.x + b.x) * 0.25, z: p.z * 0.5 + (a.z + b.z) * 0.25 };
  });
  return sm;
}

const P = (arr: number[][]): Vec2[] => arr.map(([x, z]) => ({ x, z }));

export const BUILTIN_TRACKS: TrackData[] = [
  {
    id: 'oval-park',
    name: '晨曦公园环线',
    builtin: true,
    width: 14,
    points: P([
      [0, -150], [120, -150], [200, -115], [228, -30], [196, 55], [120, 92], [60, 70], [0, 40], [-60, 70],
      [-120, 100], [-196, 62], [-226, -26], [-198, -112], [-120, -150],
    ]),
  },
  {
    id: 'hairpin-bay',
    name: '发卡湾',
    builtin: true,
    width: 12,
    points: P([
      [0, 0], [150, 0], [250, 18], [292, 88], [252, 150], [172, 140], [124, 92], [62, 112], [44, 190],
      [100, 262], [222, 282], [300, 344], [262, 420], [120, 432], [-40, 402], [-118, 322], [-100, 222],
      [-160, 160], [-240, 118], [-232, 40], [-140, 0],
    ]),
  },
  {
    id: 'grand-loop',
    name: '高速大环',
    builtin: true,
    width: 16,
    points: P([
      [0, 0], [300, 0], [480, 60], [560, 200], [522, 340], [382, 382], [262, 302], [162, 322], [100, 422],
      [-60, 442], [-222, 380], [-302, 240], [-262, 100], [-140, 20],
    ]),
  },
  ...REAL_TRACKS,
];
