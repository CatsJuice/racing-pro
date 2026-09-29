/** End-to-end check against a deployed server: simulate a real lap, upload it, read it back. */
import { BUILTIN_CARS } from '../src/car/setup';
import { ASSISTS, VehiclePhysics } from '../src/car/physics';
import { F, FRAME_STRIDE, packFrames } from '../src/core/lapFormat';
import { OFFICIAL_TRACKS, trackHash } from '../src/track/official';
import { TrackGeometry } from '../src/track/track';

// writes a test user + lap: point BASE at a local dev server (pnpm dev) unless you mean to test production
const BASE = process.env.BASE ?? 'http://localhost:5173';
const track = OFFICIAL_TRACKS[0];
const g = new TrackGeometry(track);
const p = new VehiclePhysics(BUILTIN_CARS[0]);
p.assist = ASSISTS.novice;
const hints = [-1, -1, -1, -1];
p.surfaceFn = (x, z, i) => {
  const pr = g.project(x, z, hints[i]);
  hints[i] = pr.index;
  return Math.abs(pr.lateral) < g.width / 2 + 1.4 ? { grip: 1, rolling: 0, kind: 'asphalt' } : { grip: 0.62, rolling: 0.05, kind: 'grass' };
};
const st = g.pointAt(-12);
p.reset(st.x, st.z, Math.atan2(st.tx, st.tz));
const dt = 1 / 60;
let hint = -1, lastS = g.length - 12, t = 0, lapStart = -1, acc = 0, top = 0;
const frames: number[] = [];
const sectors: number[] = [];
const rec = (lt: number, s: number) => {
  const v = new Array(FRAME_STRIDE).fill(0);
  v[F.t] = lt; v[F.x] = p.x; v[F.z] = p.z; v[F.heading] = p.heading; v[F.speed] = p.speed; v[F.s] = s; v[F.gear] = p.gear; v[F.rpm] = p.rpm;
  v[F.throttle] = p.throttleOut; v[F.brake] = p.brakeOut; v[F.steer] = p.steerAngle;
  frames.push(...v);
};
let lapTime = 0;
for (let i = 0; i < 60 * 120 && !lapTime; i++) {
  const pr = g.project(p.x, p.z, hint);
  hint = pr.index;
  const la = g.pointAt(pr.s + 6 + p.speed * 0.45);
  const dx = la.x - p.x, dz = la.z - p.z;
  const ang = Math.atan2(dx * Math.cos(p.heading) - dz * Math.sin(p.heading), dx * Math.sin(p.heading) + dz * Math.cos(p.heading));
  let maxC = 0;
  for (let d = 0; d < Math.max(30, p.speed ** 2 / 14); d += 4) maxC = Math.max(maxC, Math.abs(g.at(Math.floor(((pr.s + d) % g.length) / g.length * g.count)).curv));
  const vT = Math.sqrt(9.81 * 1.3 / Math.max(maxC, 1e-3));
  p.update(dt, { throttle: p.speed < vT ? 1 : 0, brake: p.speed > vT + 2 ? 1 : 0, steer: Math.max(-1, Math.min(1, ang * 3)), handbrake: 0 });
  const prevT = t;
  t += dt;
  const s = g.project(p.x, p.z, hint).s;
  const crossed = lastS > g.length - 40 && s < 40;
  if (crossed) {
    const tc = prevT + dt * ((g.length - lastS) / (g.length - lastS + s));
    if (lapStart >= 0 && sectors.length === 2) {
      lapTime = tc - lapStart;
      sectors.push(lapTime - sectors[0] - sectors[1]);
      rec(lapTime, g.length);
    } else {
      lapStart = tc;
      rec(t - tc, s);
    }
  }
  if (lapStart >= 0 && !lapTime) {
    const lt = t - lapStart;
    for (const [k, m] of [[0, g.length / 3], [1, (2 * g.length) / 3]] as const) {
      if (sectors.length === k && lastS < m && s >= m) sectors.push(lt - (k ? sectors[0] : 0));
    }
    top = Math.max(top, p.speed);
    acc += dt;
    if (acc >= 1 / 30) { acc -= 1 / 30; rec(lt, lt < 5 && s > g.length / 2 ? s - g.length : s); }
  }
  lastS = s;
}
const arr = new Float32Array(frames);
arr[arr.length - FRAME_STRIDE + F.t] = lapTime;
console.log('simulated lap', lapTime.toFixed(3), 'frames', arr.length / FRAME_STRIDE);

const j = async (r: Response) => ({ status: r.status, body: await r.json() });
const user = await j(await fetch(`${BASE}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '代理测试-待删除' }) }));
console.log('register', user.status, user.body.id);
const auth = { 'content-type': 'application/json', authorization: `Bearer ${user.body.token}` };
const sub = await j(await fetch(`${BASE}/api/laps`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ trackId: track.id, trackHash: trackHash(track), time: lapTime, sectors, car: { ...BUILTIN_CARS[0], name: '测试车' }, assist: 'novice', rewinds: 0, topSpeed: top * 3.6, frames: await packFrames(arr) }),
}));
console.log('submit', sub.status, JSON.stringify(sub.body));
const board = await j(await fetch(`${BASE}/api/tracks/${track.id}/board?limit=5`, { headers: auth }));
console.log('board', board.status, board.body.total, JSON.stringify(board.body.me), board.body.entries.map((e: any) => `${e.name} ${e.time.toFixed(3)}`));
if (sub.body.lapId) {
  const lap = await j(await fetch(`${BASE}/api/laps/${sub.body.lapId}`));
  console.log('replay', lap.status, 'frames b64 bytes', lap.body.frames?.length, 'player', lap.body.name);
}
console.log('USER_IDS', user.body.id);
