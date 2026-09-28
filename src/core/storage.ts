import type { AssistLevel } from '../car/physics';
import { BUILTIN_CARS, type CarSetup, normalizeSetup } from '../car/setup';
import { BUILTIN_TRACKS, type TrackData } from '../track/track';

const TRACK_KEY = 'racing-pro.tracks';
const CAR_KEY = 'racing-pro.cars';
const PREF_KEY = 'racing-pro.prefs';

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    console.warn('storage write failed', e);
  }
}

// ---------------------------------------------------------------- tracks
export function listTracks(): TrackData[] {
  const custom = readJSON<TrackData[]>(TRACK_KEY, []);
  return [...BUILTIN_TRACKS, ...custom];
}

export function getTrack(id: string): TrackData | undefined {
  return listTracks().find((t) => t.id === id);
}

export function saveTrack(t: TrackData) {
  const custom = readJSON<TrackData[]>(TRACK_KEY, []);
  const copy = { ...t, builtin: false, updated: Date.now() };
  const i = custom.findIndex((c) => c.id === t.id);
  if (i >= 0) custom[i] = copy;
  else custom.push(copy);
  writeJSON(TRACK_KEY, custom);
}

export function deleteTrack(id: string) {
  writeJSON(TRACK_KEY, readJSON<TrackData[]>(TRACK_KEY, []).filter((t) => t.id !== id));
  deleteLapsForTrack(id).catch(() => {});
}

// ---------------------------------------------------------------- cars
export function listCars(): CarSetup[] {
  const custom = readJSON<CarSetup[]>(CAR_KEY, []).map(normalizeSetup);
  return [...BUILTIN_CARS.map((c) => ({ ...c, builtin: true })), ...custom];
}

export function getCar(id: string): CarSetup | undefined {
  return listCars().find((c) => c.id === id);
}

export function saveCar(c: CarSetup) {
  const custom = readJSON<CarSetup[]>(CAR_KEY, []);
  const copy = { ...c, builtin: false };
  const i = custom.findIndex((x) => x.id === c.id);
  if (i >= 0) custom[i] = copy;
  else custom.push(copy);
  writeJSON(CAR_KEY, custom);
}

export function deleteCar(id: string) {
  writeJSON(CAR_KEY, readJSON<CarSetup[]>(CAR_KEY, []).filter((c) => c.id !== id));
}

// ---------------------------------------------------------------- prefs
export interface Prefs {
  lastTrack?: string;
  lastCar?: string;
  muted?: boolean;
  ghost?: boolean;
  camera?: number;
  assist?: AssistLevel;
}

export function getPrefs(): Prefs {
  return readJSON<Prefs>(PREF_KEY, { ghost: true });
}

export function setPrefs(p: Partial<Prefs>) {
  writeJSON(PREF_KEY, { ...getPrefs(), ...p });
}

// ---------------------------------------------------------------- laps (IndexedDB)
export { F, FRAME_STRIDE } from './lapFormat';

export interface LapRecord {
  id: string;
  trackId: string;
  trackName: string;
  carId: string;
  carName: string;
  car: CarSetup;
  time: number; // seconds
  sectors: number[];
  date: number;
  frames: Float32Array;
  topSpeed: number;
  assist?: AssistLevel;
  rewinds?: number;
  /** set for laps fetched from the global leaderboard */
  playerName?: string;
  userId?: string;
  online?: boolean;
}

export type LapSummary = Omit<LapRecord, 'frames'>;

const MAX_LAPS_PER_TRACK = 20;
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('racing-pro', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        const s = d.createObjectStore('laps', { keyPath: 'id' });
        s.createIndex('trackId', 'trackId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction('laps', mode);
        const s = t.objectStore('laps');
        const r = fn(s);
        t.oncomplete = () => resolve(r ? (r.result as T) : (undefined as T));
        t.onerror = () => reject(t.error);
      }),
  );
}

export async function lapsForTrack(trackId: string): Promise<LapRecord[]> {
  const all = await tx<LapRecord[]>('readonly', (s) => s.index('trackId').getAll(trackId));
  return (all || []).sort((a, b) => a.time - b.time);
}

export async function getLap(id: string): Promise<LapRecord | undefined> {
  return tx<LapRecord | undefined>('readonly', (s) => s.get(id));
}

/** Stores a lap if it makes the top list. Returns its rank (1-based) or 0. */
export async function submitLap(lap: LapRecord): Promise<number> {
  const laps = await lapsForTrack(lap.trackId);
  const rank = laps.filter((l) => l.time < lap.time).length + 1;
  if (rank > MAX_LAPS_PER_TRACK) return 0;
  await tx('readwrite', (s) => s.put(lap));
  const drop = laps.slice(MAX_LAPS_PER_TRACK - 1);
  if (drop.length) await tx('readwrite', (s) => { drop.forEach((d) => s.delete(d.id)); });
  return rank;
}

export async function deleteLap(id: string) {
  await tx('readwrite', (s) => s.delete(id));
}

export async function deleteLapsForTrack(trackId: string) {
  const laps = await lapsForTrack(trackId);
  await tx('readwrite', (s) => { laps.forEach((l) => s.delete(l.id)); });
}

export async function bestLap(trackId: string): Promise<LapRecord | undefined> {
  return (await lapsForTrack(trackId))[0];
}

export function fmtTime(t: number | undefined | null) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function fmtDelta(d: number) {
  return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);
}
