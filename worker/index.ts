/**
 * Racing Pro API (Cloudflare Worker + D1).
 *
 *   POST /api/users                 {name}            -> {id, name, token}
 *   GET  /api/me                    (auth)            -> {id, name}
 *   PUT  /api/me                    (auth) {name}     -> {id, name}
 *   GET  /api/tracks/:id/board?limit=100 (auth optional) -> {trackHash, total, entries, me}
 *   POST /api/laps                  (auth) lap        -> {improved, rank, best}
 *   GET  /api/laps/:id                                -> full lap incl. gzipped frames (base64)
 *
 * Auth: `Authorization: Bearer <token>`; only a SHA-256 of the token is stored.
 * Errors are `{ error: <code> }`; the client translates the code (see `err.*` in src/i18n).
 */
import { base64ToBytes, F, FRAME_STRIDE, unpackFrames } from '../src/core/lapFormat';
import { OFFICIAL_TRACKS, trackHash } from '../src/track/official';
import { TrackGeometry } from '../src/track/track';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const ASSISTS = new Set(['novice', 'standard', 'pro']);
const SUBMIT_COOLDOWN_MS = 4000;
const MAX_FRAMES_B64 = 900_000;

// track geometry is only needed for validation; cache it per isolate
const geoCache = new Map<string, { geo: TrackGeometry; hash: string }>();
function official(id: string) {
  let g = geoCache.get(id);
  if (!g) {
    const t = OFFICIAL_TRACKS.find((x) => x.id === id);
    if (!t) return null;
    g = { geo: new TrackGeometry(t), hash: trackHash(t) };
    geoCache.set(id, g);
  }
  return g;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanName(raw: unknown) {
  if (typeof raw !== 'string') throw new HttpError(400, 'badName');
  // strip control characters and collapse whitespace
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > 16) throw new HttpError(400, 'nameLength');
  return name;
}

async function auth(req: Request, env: Env, required: true): Promise<{ id: string; name: string; last_submit: number }>;
async function auth(req: Request, env: Env, required: false): Promise<{ id: string; name: string; last_submit: number } | null>;
async function auth(req: Request, env: Env, required: boolean) {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) {
    if (required) throw new HttpError(401, 'unauthorized');
    return null;
  }
  const row = await env.DB.prepare('SELECT id, name, last_submit FROM users WHERE token_hash = ?').bind(await sha256(token)).first<{ id: string; name: string; last_submit: number }>();
  if (!row && required) throw new HttpError(401, 'badToken');
  return row ?? null;
}

async function body<T>(req: Request, limit = 1_200_000): Promise<T> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > limit) throw new HttpError(413, 'tooLarge');
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'badRequest');
  }
}

// ------------------------------------------------------------------ lap validation
interface LapSubmission {
  trackId: string;
  trackHash: string;
  time: number;
  sectors: number[];
  car: Record<string, unknown>;
  assist: string;
  rewinds: number;
  topSpeed: number;
  frames: string; // gzip + base64 Float32Array
}

async function validateLap(lap: LapSubmission) {
  const t = official(lap.trackId);
  if (!t) throw new HttpError(400, 'notOfficial');
  if (lap.trackHash !== t.hash) throw new HttpError(409, 'trackOutdated');
  const L = t.geo.length;
  const time = Number(lap.time);
  if (!isFinite(time) || time < L / 95 || time > 3600) throw new HttpError(422, 'lapTime');
  if (!Array.isArray(lap.sectors) || lap.sectors.length !== 3 || lap.sectors.some((x) => typeof x !== 'number' || !(x > 0))) throw new HttpError(422, 'sectors');
  if (Math.abs(lap.sectors.reduce((a, b) => a + b, 0) - time) > 0.05) throw new HttpError(422, 'sectorSum');
  if (!ASSISTS.has(lap.assist)) throw new HttpError(422, 'assist');
  if (!lap.car || typeof lap.car !== 'object' || JSON.stringify(lap.car).length > 8000) throw new HttpError(422, 'car');
  if (typeof lap.frames !== 'string' || lap.frames.length > MAX_FRAMES_B64) throw new HttpError(422, 'replay');

  const gz = base64ToBytes(lap.frames);
  let frames: Float32Array;
  try {
    frames = await unpackFrames(gz);
  } catch {
    throw new HttpError(422, 'replayCorrupt');
  }
  const n = Math.floor(frames.length / FRAME_STRIDE);
  if (frames.length % FRAME_STRIDE !== 0 || n < time * 20 || n > time * 40 + 10) throw new HttpError(422, 'frameCount');
  const get = (i: number, f: number) => frames[i * FRAME_STRIDE + f];
  if (Math.abs(get(n - 1, F.t) - time) > 0.06) throw new HttpError(422, 'replayDuration');
  if (get(0, F.s) > 15 || get(n - 1, F.s) < L - 5) throw new HttpError(422, 'incomplete');
  let maxSpeed = 0, maxOff = 0, hint = -1;
  for (let i = 0; i < n; i++) {
    for (let f = 0; f < FRAME_STRIDE; f++) if (!isFinite(get(i, f))) throw new HttpError(422, 'replayCorrupt');
    const v = get(i, F.speed);
    maxSpeed = Math.max(maxSpeed, v);
    if (i > 0) {
      const dt = get(i, F.t) - get(i - 1, F.t);
      if (dt <= 0 || dt > 0.2) throw new HttpError(422, 'timeline');
      const d = Math.hypot(get(i, F.x) - get(i - 1, F.x), get(i, F.z) - get(i - 1, F.z));
      const vAvg = (v + get(i - 1, F.speed)) / 2;
      if (d > vAvg * dt * 1.6 + 1.5) throw new HttpError(422, 'teleport');
    }
    if (i % 10 === 0) {
      const pr = t.geo.project(get(i, F.x), get(i, F.z), hint);
      hint = pr.index;
      maxOff = Math.max(maxOff, Math.abs(pr.lateral));
    }
  }
  if (maxSpeed > 125) throw new HttpError(422, 'speed');
  if (maxOff > t.geo.width / 2 + 45) throw new HttpError(422, 'offTrack');
  // the replay's average speed must match the lap time
  let dist = 0;
  for (let i = 1; i < n; i++) dist += Math.hypot(get(i, F.x) - get(i - 1, F.x), get(i, F.z) - get(i - 1, F.z));
  if (dist < L * 0.85) throw new HttpError(422, 'distance');
  return gz;
}

// ------------------------------------------------------------------ routes
async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/users' && m === 'POST') {
    const { name } = await body<{ name: string }>(req, 2000);
    const clean = cleanName(name);
    const id = crypto.randomUUID();
    const tokenBytes = crypto.getRandomValues(new Uint8Array(24));
    const token = [...tokenBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('INSERT INTO users (id, name, token_hash, created) VALUES (?, ?, ?, ?)').bind(id, clean, await sha256(token), Date.now()).run();
    return json({ id, name: clean, token }, 201);
  }

  if (p === '/api/me' && m === 'GET') {
    const u = await auth(req, env, true);
    return json({ id: u.id, name: u.name });
  }

  if (p === '/api/me' && m === 'PUT') {
    const u = await auth(req, env, true);
    const { name } = await body<{ name: string }>(req, 2000);
    const clean = cleanName(name);
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(clean, u.id).run();
    return json({ id: u.id, name: clean });
  }

  let mm = p.match(/^\/api\/tracks\/([\w-]+)\/board$/);
  if (mm && m === 'GET') {
    const t = official(mm[1]);
    if (!t) throw new HttpError(404, 'notOfficial');
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 100)));
    const u = await auth(req, env, false);
    const rows = await env.DB.prepare(
      `SELECT l.id, l.user_id, u.name, l.time, l.sectors, l.car, l.assist, l.rewinds, l.top_speed, l.created
       FROM laps l JOIN users u ON u.id = l.user_id
       WHERE l.track_id = ? AND l.track_hash = ? ORDER BY l.time ASC, l.created ASC LIMIT ?`,
    ).bind(mm[1], t.hash, limit).all();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM laps WHERE track_id = ? AND track_hash = ?').bind(mm[1], t.hash).first<{ n: number }>();
    let me: unknown = null;
    if (u) {
      const mine = await env.DB.prepare('SELECT id, time FROM laps WHERE track_id = ? AND track_hash = ? AND user_id = ?').bind(mm[1], t.hash, u.id).first<{ id: string; time: number }>();
      if (mine) {
        const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM laps WHERE track_id = ? AND track_hash = ? AND time < ?').bind(mm[1], t.hash, mine.time).first<{ n: number }>();
        me = { lapId: mine.id, time: mine.time, rank: (r?.n ?? 0) + 1 };
      }
    }
    const entries = (rows.results as any[]).map((r) => ({
      lapId: r.id, userId: r.user_id, name: r.name, time: r.time, sectors: JSON.parse(r.sectors), car: JSON.parse(r.car),
      assist: r.assist, rewinds: r.rewinds, topSpeed: r.top_speed, date: r.created,
    }));
    return json({ trackHash: t.hash, total: total?.n ?? 0, entries, me });
  }

  if (p === '/api/laps' && m === 'POST') {
    const u = await auth(req, env, true);
    const now = Date.now();
    if (now - u.last_submit < SUBMIT_COOLDOWN_MS) throw new HttpError(429, 'rateLimit');
    const lap = await body<LapSubmission>(req);
    const gz = await validateLap(lap);
    await env.DB.prepare('UPDATE users SET last_submit = ? WHERE id = ?').bind(now, u.id).run();
    const prev = await env.DB.prepare('SELECT id, time FROM laps WHERE track_id = ? AND track_hash = ? AND user_id = ?').bind(lap.trackId, lap.trackHash, u.id).first<{ id: string; time: number }>();
    const improved = !prev || lap.time < prev.time;
    let lapId = prev?.id;
    if (improved) {
      lapId = crypto.randomUUID();
      const car = { ...lap.car, name: String((lap.car as any).name ?? '').slice(0, 24) };
      await env.DB.prepare(
        `INSERT INTO laps (id, track_id, track_hash, user_id, time, sectors, car, assist, rewinds, top_speed, created, frames)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (track_id, track_hash, user_id) DO UPDATE SET
           id = excluded.id, time = excluded.time, sectors = excluded.sectors, car = excluded.car, assist = excluded.assist,
           rewinds = excluded.rewinds, top_speed = excluded.top_speed, created = excluded.created, frames = excluded.frames`,
      ).bind(lapId, lap.trackId, lap.trackHash, u.id, lap.time, JSON.stringify(lap.sectors), JSON.stringify(car), lap.assist,
        Math.max(0, Math.floor(lap.rewinds || 0)), Math.min(500, Number(lap.topSpeed) || 0), now, gz).run();
    }
    const best = improved ? lap.time : prev!.time;
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM laps WHERE track_id = ? AND track_hash = ? AND time < ?').bind(lap.trackId, lap.trackHash, best).first<{ n: number }>();
    return json({ improved, rank: (r?.n ?? 0) + 1, best, lapId });
  }

  mm = p.match(/^\/api\/laps\/([\w-]+)$/);
  if (mm && m === 'GET') {
    const r = await env.DB.prepare(
      `SELECT l.*, u.name FROM laps l JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
    ).bind(mm[1]).first<any>();
    if (!r) throw new HttpError(404, 'lapGone');
    const bytes = new Uint8Array(r.frames as ArrayBuffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return new Response(JSON.stringify({
      lapId: r.id, trackId: r.track_id, trackHash: r.track_hash, userId: r.user_id, name: r.name, time: r.time,
      sectors: JSON.parse(r.sectors), car: JSON.parse(r.car), assist: r.assist, rewinds: r.rewinds, topSpeed: r.top_speed,
      date: r.created, frames: btoa(s),
    }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400, immutable' } });
  }

  throw new HttpError(404, 'notFound');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'server' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
