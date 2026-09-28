import { BUILTIN_CARS } from '../src/car/setup';
import { simulatePerformance, VehiclePhysics } from '../src/car/physics';

for (const c of BUILTIN_CARS) {
  const t0 = performance.now();
  const p = simulatePerformance(c);
  console.log(c.name.padEnd(8), `0-100 ${p.zeroTo100.toFixed(2)}s  0-200 ${p.zeroTo200.toFixed(2)}s  top ${p.topSpeed.toFixed(0)}km/h  brake100 ${p.brake100.toFixed(1)}m  latG ${p.lateralG.toFixed(2)}  (${(performance.now() - t0).toFixed(0)}ms)`);
}
// constant-radius cornering test: full throttle then steer, watch for NaN / spin
const v = new VehiclePhysics(BUILTIN_CARS[0]);
v.reset(0, 0, 0);
for (let i = 0; i < 60 * 20; i++) {
  v.update(1 / 60, { throttle: i < 300 ? 1 : 0.5, brake: 0, steer: i > 300 ? 0.6 : 0, handbrake: 0 });
  if (i % 120 === 0) console.log(i / 60, 'spd', v.speedKmh.toFixed(1), 'gear', v.gear, 'rpm', v.rpm.toFixed(0), 'yaw', v.yawRate.toFixed(2), 'roll°', (v.roll * 57.3).toFixed(2), 'pitch°', (v.pitch * 57.3).toFixed(2), 'loads', v.wheels.map(w => w.load.toFixed(0)).join('/'));
}
