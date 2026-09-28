/**
 * Simulates a keyboard player (binary steer/throttle/brake, imperfect speed judgement)
 * and reports how often they spin / leave the track.
 */
import { BUILTIN_CARS } from '../src/car/setup';
import { VehiclePhysics, type DrivingAssist } from '../src/car/physics';
import { BUILTIN_TRACKS, TrackGeometry } from '../src/track/track';

const level = (process.env.ASSIST ?? 'none') as any;
const overdrive = Number(process.env.OVER ?? 1.25); // how much faster than the grip limit the "player" tries to go

export function run(carIdx: number, trackIdx: number, assist: DrivingAssist | null) {
  const g = new TrackGeometry(BUILTIN_TRACKS[trackIdx]);
  const p = new VehiclePhysics(BUILTIN_CARS[carIdx]);
  if (assist) p.assist = assist;
  const hints = [-1, -1, -1, -1];
  let offWheels = 0;
  p.surfaceFn = (x, z, i) => {
    const pr = g.project(x, z, hints[i]);
    hints[i] = pr.index;
    return Math.abs(pr.lateral) < g.width / 2 + 1.4 ? { grip: 1, rolling: 0, kind: 'asphalt' } : { grip: 0.62, rolling: 0.05, kind: 'grass' };
  };
  const st = g.startPose();
  p.reset(st.x, st.z, st.heading);
  const trace: any[] = [];
  let hint = -1, dist = 0, lastS = 0, offTime = 0, spins = 0, spinning = false, offEvents = 0, wasOff = false;
  const dt = 1 / 60;
  for (let f = 0; f < 60 * 150; f++) {
    const pr = g.project(p.x, p.z, hint);
    hint = pr.index;
    const la = g.pointAt(pr.s + 6 + p.speed * 0.45);
    const dx = la.x - p.x, dz = la.z - p.z;
    const lx = dx * Math.cos(p.heading) - dz * Math.sin(p.heading), fx = dx * Math.sin(p.heading) + dz * Math.cos(p.heading);
    const ang = Math.atan2(lx, fx);
    let maxC = 0;
    for (let d = 0; d < Math.max(30, p.speed * p.speed / 14); d += 4) maxC = Math.max(maxC, Math.abs(g.at(Math.floor(((pr.s + d) % g.length) / g.length * g.count)).curv));
    const vT = Math.sqrt(9.81 * 1.0 * overdrive / Math.max(maxC, 1e-3));
    const steer = ang > 0.04 ? 1 : ang < -0.04 ? -1 : 0; // keyboard!
    trace.push({ t: +(f / 60).toFixed(1), v: +(p.speed * 3.6).toFixed(0), thr: p.speed < vT ? 1 : 0, brk: p.speed > vT + 2 ? 1 : 0, steer, beta: +(Math.atan2(p.vLat, p.vLong) * 57.3).toFixed(1), gear: p.gear, yaw: +p.yawRate.toFixed(2) });
    if (trace.length > 60) trace.splice(0, 30);
    p.update(dt, { throttle: p.speed < vT ? 1 : 0, brake: p.speed > vT + 2 ? 1 : 0, steer, handbrake: 0 });
    let ds = pr.s - lastS; if (ds < -g.length / 2) ds += g.length; if (ds > g.length / 2) ds -= g.length;
    dist += ds; lastS = pr.s;
    const beta = Math.abs(Math.atan2(p.vLat, Math.abs(p.vLong) + 0.1));
    if (beta > 0.6 && p.speed > 5) { if (!spinning) { spins++; if (process.env.TRACE) console.log('spin', JSON.stringify(trace.slice(-4))); } spinning = true; } else if (beta < 0.2) spinning = false;
    const off = Math.abs(pr.lateral) > g.width / 2 + 2;
    if (off) offTime += dt;
    if (off && !wasOff) offEvents++;
    wasOff = off;
    void offWheels;
  }
  return { laps: +(dist / g.length).toFixed(2), spins, offEvents, offTime: +offTime.toFixed(1) };
}

const { ASSISTS } = await import('../src/car/physics');
const a = level === 'none' ? null : (ASSISTS as any)[level];
for (let c = 0; c < (process.env.TRACE ? 1 : BUILTIN_CARS.length); c++) {
  const r = [0, 1, 2].map((t) => run(c, t, a));
  console.log(BUILTIN_CARS[c].name.padEnd(8), r.map((x) => `laps ${x.laps} spin ${x.spins} off ${x.offEvents}/${x.offTime}s`).join(' | '));
}
