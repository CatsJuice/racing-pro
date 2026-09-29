import type { AssistLevel } from '../car/physics';
import { normalizeSetup, type CarSetup } from '../car/setup';
import { OFFICIAL_TRACKS, trackHash } from '../track/official';
import { base64ToBytes, packFrames, unpackFrames } from './lapFormat';
import { t, tx } from '../i18n';
import type { LapRecord } from './storage';

const ID_KEY = 'racing-pro.identity';

export interface Identity {
  id: string;
  name: string;
  token: string;
}

export interface BoardEntry {
  lapId: string;
  userId: string;
  name: string;
  time: number;
  sectors: number[];
  car: CarSetup;
  assist: AssistLevel;
  rewinds: number;
  topSpeed: number;
  date: number;
}

export interface Board {
  trackHash: string;
  total: number;
  entries: BoardEntry[];
  me: { lapId: string; time: number; rank: number } | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function identity(): Identity | null {
  try {
    const raw = localStorage.getItem(ID_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

function saveIdentity(i: Identity) {
  try {
    localStorage.setItem(ID_KEY, JSON.stringify(i));
  } catch {
    /* private mode: identity lives for this session only */
  }
  listeners.forEach((l) => l(i));
}

const listeners = new Set<(i: Identity) => void>();
export function onIdentity(fn: (i: Identity) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function api<T>(path: string, init: RequestInit = {}, withAuth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const id = identity();
  if (withAuth && id) headers.set('authorization', `Bearer ${id.token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, t('err.network'));
  }
  const data = await res.json().catch(() => ({}));
  const code = (data as any).error as string | undefined;
  if (!res.ok) throw new ApiError(res.status, code ? tx(`err.${code}`, code) : t('err.request', { status: res.status }));
  return data as T;
}

export async function register(name: string): Promise<Identity> {
  const r = await api<Identity>('/api/users', { method: 'POST', body: JSON.stringify({ name }) });
  saveIdentity(r);
  return r;
}

export async function rename(name: string): Promise<Identity> {
  const cur = identity();
  if (!cur) return register(name);
  const r = await api<{ id: string; name: string }>('/api/me', { method: 'PUT', body: JSON.stringify({ name }) }, true);
  const next = { ...cur, name: r.name };
  saveIdentity(next);
  return next;
}

export function officialHash(trackId: string) {
  const t = OFFICIAL_TRACKS.find((x) => x.id === trackId);
  return t ? trackHash(t) : null;
}

export async function fetchBoard(trackId: string, limit = 100): Promise<Board> {
  return api<Board>(`/api/tracks/${encodeURIComponent(trackId)}/board?limit=${limit}`, {}, true);
}

export interface SubmitResult {
  improved: boolean;
  rank: number;
  best: number;
  lapId: string;
}

export async function submitOnline(lap: LapRecord): Promise<SubmitResult> {
  const hash = officialHash(lap.trackId);
  if (!hash) throw new ApiError(400, t('err.notOfficial'));
  if (!identity()) throw new ApiError(401, t('err.needName'));
  const { id: _id, builtin: _b, ...car } = lap.car;
  void _id; void _b;
  return api<SubmitResult>('/api/laps', {
    method: 'POST',
    body: JSON.stringify({
      trackId: lap.trackId,
      trackHash: hash,
      time: lap.time,
      sectors: lap.sectors,
      car: { ...car, id: lap.carId },
      assist: lap.assist ?? 'pro',
      rewinds: lap.rewinds ?? 0,
      topSpeed: lap.topSpeed,
      frames: await packFrames(lap.frames),
    }),
  }, true);
}

const lapCache = new Map<string, Promise<LapRecord>>();

/** Downloads a leaderboard lap (with replay frames) as a LapRecord. */
export function fetchOnlineLap(lapId: string): Promise<LapRecord> {
  let p = lapCache.get(lapId);
  if (!p) {
    p = api<any>(`/api/laps/${encodeURIComponent(lapId)}`).then(async (r) => {
      const track = OFFICIAL_TRACKS.find((t) => t.id === r.trackId);
      const car = normalizeSetup({ ...r.car, builtin: false });
      return {
        id: r.lapId,
        trackId: r.trackId,
        trackName: track?.name ?? r.trackId,
        carId: String(r.car?.id ?? 'online'),
        carName: car.name,
        car,
        time: r.time,
        sectors: r.sectors,
        date: r.date,
        frames: await unpackFrames(base64ToBytes(r.frames)),
        topSpeed: r.topSpeed,
        assist: r.assist,
        rewinds: r.rewinds,
        playerName: r.name,
        userId: r.userId,
        online: true,
      } satisfies LapRecord;
    });
    p.catch(() => lapCache.delete(lapId));
    lapCache.set(lapId, p);
  }
  return p;
}

export function randomName() {
  const pool = t('names.pool').split(',');
  return pool[Math.floor(Math.random() * pool.length)].trim() + Math.floor(100 + Math.random() * 900);
}
