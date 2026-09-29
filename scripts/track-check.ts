import { REAL_TRACKS } from '../src/track/realTracks';
import { TrackGeometry, validateTrack } from '../src/track/track';
for (const t of REAL_TRACKS) {
  const g = new TrackGeometry(t);
  const minR = 1 / Math.max(...g.samples.map((s) => Math.abs(s.curv)));
  console.log(t.name.padEnd(10), `${(g.length / 1000).toFixed(3)} km`, `minR ${minR.toFixed(1)} m`, JSON.stringify(validateTrack(t).map((i) => i.msg)));
}
