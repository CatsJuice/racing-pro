import { BUILTIN_TRACKS, type TrackData } from './track';

/** Official tracks have a global, server-side leaderboard. */
export const OFFICIAL_TRACKS = BUILTIN_TRACKS;

export function isOfficial(trackId: string) {
  return OFFICIAL_TRACKS.some((t) => t.id === trackId);
}

/** Version fingerprint of a track layout; laps only compete against the same layout. */
export function trackHash(t: TrackData) {
  const s = JSON.stringify([t.width, t.points.map((p) => [Math.round(p.x * 100), Math.round(p.z * 100)])]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
