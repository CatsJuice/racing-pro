import { DEFAULT_SETUP, type CarSetup } from '../src/car/setup';
import { VehiclePhysics } from '../src/car/physics';

// steady cornering at ~90 km/h with fixed steering: higher yaw rate = more oversteer / more grip at the front
const STEER = Number(process.env.STEER ?? 0.28);
function corner(s: CarSetup) {
  const p = new VehiclePhysics({ ...s, stability: 0, steerSensitivity: 0 });
  p.reset(0, 0, 0);
  const v0 = 25;
  p.vz = v0;
  for (const w of p.wheels) w.omega = v0 / 0.32;
  p.gear = 3;
  let yaw = 0, lat = 0, roll = 0, n = 0, spun = false;
  for (let i = 0; i < 60 * 6; i++) {
    const err = v0 - p.speed;
    p.update(1 / 60, { throttle: Math.max(0, Math.min(1, err * 0.4 + 0.3)), brake: 0, steer: Math.min(STEER, i / 120), handbrake: 0 });
    if (Math.abs(p.vLat) > 8) spun = true;
    if (i > 240) { yaw += p.yawRate; lat += p.accLat; roll += p.roll; n++; }
  }
  return { yaw: (yaw / n).toFixed(3), latG: (lat / n / 9.81).toFixed(2), rollDeg: (roll / n * 57.3).toFixed(2), beta: (Math.atan2(p.vLat, p.vLong) * 57.3).toFixed(1), spun };
}
const cases: [string, Partial<CarSetup>][] = [
  ['baseline', {}],
  ['stiff front ARB', { arbF: 200 }],
  ['stiff rear ARB', { arbR: 200 }],
  ['soft springs', { springF: 30, springR: 30, arbF: 0, arbR: 0 }],
  ['no front camber', { camberF: 0 }],
  ['-5 front camber', { camberF: -5 }],
  ['front heavy 62%', { frontWeight: 0.62 }],
  ['rear heavy 40%', { frontWeight: 0.4 }],
  ['street tires', { tireGrip: 0.95 }],
  ['narrow rear tires', { tireWidthR: 185 }],
  ['toe-out rear', { toeR: -0.6 }],
  ['high CoG', { cogHeight: 0.7 }],
  ['big rear wing', { downforceR: 2.2 }],
];
for (const [name, d] of cases) console.log(name.padEnd(18), JSON.stringify(corner({ ...DEFAULT_SETUP, ...d })));
