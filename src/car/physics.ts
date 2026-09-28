import { type CarSetup, engineTorqueCurve, gearRatios } from './setup';

/**
 * Four wheel vehicle model.
 *
 * Body frame: x forward, y left, z up. Yaw is positive counter-clockwise seen from above
 * (i.e. turning left). World frame is three.js: forward(heading) = (sin h, 0, cos h), left = (cos h, 0, -sin h).
 *
 * Degrees of freedom: planar motion (x, z, heading), sprung body heave/pitch/roll on four
 * spring-damper corners with anti-roll bars, and four wheel spin rates coupled through
 * differentials to an engine + gearbox.
 */

const G = 9.81;
const RHO = 1.225;
const FRONTAL_AREA = 2.0;
const WHEEL_R = 0.32;
const FZ_NOMINAL = 3500;
const DEG = Math.PI / 180;

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (+ = left)
  handbrake: number; // 0..1
  shiftUp?: boolean;
  shiftDown?: boolean;
}

export interface Surface {
  grip: number;
  rolling: number; // extra rolling resistance coefficient
  kind: 'asphalt' | 'kerb' | 'grass';
}

export type SurfaceFn = (x: number, z: number, wheelIndex: number) => Surface;

/** Player-level driving aids, independent from the car setup. */
export interface DrivingAssist {
  /** never steer further than the front tyres can use at the current speed */
  steerLimit: boolean;
  /** automatic counter-steer toward the direction of travel (0..1) */
  counterSteer: number;
  /** minimum yaw stability control (0..1) */
  stability: number;
  tcs: boolean;
  abs: boolean;
}

export type AssistLevel = 'novice' | 'standard' | 'pro';

export const ASSISTS: Record<AssistLevel, DrivingAssist> = {
  novice: { steerLimit: true, counterSteer: 0.8, stability: 0.8, tcs: true, abs: true },
  standard: { steerLimit: true, counterSteer: 0.4, stability: 0.4, tcs: true, abs: true },
  pro: { steerLimit: false, counterSteer: 0, stability: 0, tcs: false, abs: false },
};

export const ASSIST_LABELS: Record<AssistLevel, string> = { novice: '新手', standard: '标准', pro: '专业' };

const ASPHALT: Surface = { grip: 1, rolling: 0, kind: 'asphalt' };

export class Wheel {
  // configuration
  x = 0; // longitudinal position from CoG (+ front)
  y = 0; // lateral position (+ left)
  front = false;
  left = false;
  k = 0; // spring N/m
  cBump = 0;
  cRebound = 0;
  c0 = 0; // static compression (m)
  inertia = 1.2;
  camber = 0; // deg
  toe = 0; // rad
  widthMm = 245;
  rideHeight = 0.1; // m
  travel = 0.09;
  driven = false;

  // state
  omega = 0;
  spin = 0; // accumulated rotation angle
  steer = 0; // rad
  compression = 0;
  compVel = 0;
  load = 0;
  chassisForce = 0;
  slipRatio = 0;
  slipAngle = 0;
  combinedSlip = 0; // 1 = at peak grip
  fx = 0; // wheel frame forces
  fy = 0;
  bodyFx = 0;
  bodyFy = 0;
  surface: Surface = ASPHALT;
  absActive = false;
  worldX = 0;
  worldZ = 0;
}

export class VehiclePhysics {
  setup!: CarSetup;
  wheels: Wheel[] = [];

  // world state
  x = 0;
  z = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;

  // body
  heave = 0;
  heaveV = 0;
  pitch = 0; // + nose down
  pitchV = 0;
  roll = 0; // + left side down
  rollV = 0;

  // drivetrain
  gear = 1;
  shiftTimer = 0;
  shiftCooldown = 0;
  rpm = 900;
  reverseTimer = 0;
  tcsCut = 1;
  tcsActive = false;
  absActive = false;
  clutchSlip = false;
  scraping = false;

  steerPos = 0;
  steerAngle = 0;

  // derived / outputs
  speed = 0;
  vLong = 0;
  vLat = 0;
  accLong = 0;
  accLat = 0;
  downforce = 0;
  throttleOut = 0;
  brakeOut = 0;

  private ratios: number[] = [];
  private m = 1300;
  private a = 1.3;
  private b = 1.3;
  private tw = 1.6;
  private cogH = 0.46;
  private Iz = 2500;
  private Ip = 1100;
  private Ir = 470;
  private tireC = 1.45;
  private tireB = 1.86;

  surfaceFn: SurfaceFn = () => ASPHALT;
  assist: DrivingAssist = ASSISTS.pro;

  constructor(setup: CarSetup) {
    for (let i = 0; i < 4; i++) this.wheels.push(new Wheel());
    this.configure(setup);
  }

  configure(s: CarSetup) {
    this.setup = s;
    this.ratios = gearRatios(s);
    const m = (this.m = s.mass);
    const wb = s.wheelbase;
    this.a = wb * (1 - s.frontWeight);
    this.b = wb * s.frontWeight;
    this.tw = s.trackWidth;
    this.cogH = s.cogHeight + ((s.rideHeightF + s.rideHeightR) / 2 - 100) / 1000;
    this.Iz = m * (0.25 * wb * wb * 1.1 + 0.05 * this.tw * this.tw);
    this.Ip = m * (wb * wb / 12 + 0.3);
    this.Ir = m * (this.tw * this.tw / 12 + 0.15);
    const drop = 0.08 + 0.45 * s.tireFalloff;
    this.tireC = 2 - (2 / Math.PI) * Math.asin(1 - drop);
    this.tireB = Math.tan(Math.PI / (2 * this.tireC));

    const drivenFront = s.drivetrain !== 'RWD';
    const drivenRear = s.drivetrain !== 'FWD';
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.front = i < 2;
      w.left = i % 2 === 0;
      w.x = w.front ? this.a : -this.b;
      w.y = (w.left ? 1 : -1) * this.tw / 2;
      w.k = (w.front ? s.springF : s.springR) * 1000;
      w.cBump = (w.front ? s.bumpF : s.bumpR) * 1000;
      w.cRebound = (w.front ? s.reboundF : s.reboundR) * 1000;
      const staticLoad = m * G * (w.front ? s.frontWeight : 1 - s.frontWeight) / 2;
      w.c0 = staticLoad / w.k;
      w.widthMm = w.front ? s.tireWidthF : s.tireWidthR;
      w.inertia = 0.7 + w.widthMm * 0.0022;
      w.camber = w.front ? s.camberF : s.camberR;
      const toe = (w.front ? s.toeF : s.toeR) * DEG;
      w.toe = w.left ? -toe : toe; // toe-in points the wheel toward the centre line
      w.rideHeight = (w.front ? s.rideHeightF : s.rideHeightR) / 1000;
      w.travel = s.travel / 1000;
      w.driven = w.front ? drivenFront : drivenRear;
    }
  }

  reset(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = this.yawRate = 0;
    this.heave = this.heaveV = this.pitch = this.pitchV = this.roll = this.rollV = 0;
    this.gear = 1;
    this.shiftTimer = 0;
    this.rpm = this.setup.idleRpm;
    this.steerPos = 0;
    for (const w of this.wheels) {
      w.omega = 0;
      w.compression = w.c0;
      w.compVel = 0;
      w.load = this.m * G / 4;
    }
  }

  private static readonly SCALARS = [
    'x', 'z', 'heading', 'vx', 'vz', 'yawRate', 'heave', 'heaveV', 'pitch', 'pitchV', 'roll', 'rollV',
    'gear', 'shiftTimer', 'shiftCooldown', 'rpm', 'reverseTimer', 'tcsCut', 'steerPos', 'steerAngle',
    'speed', 'vLong', 'vLat', 'throttleOut', 'brakeOut',
  ] as const;
  private static readonly WHEEL = ['omega', 'spin', 'steer', 'compression', 'compVel', 'load', 'slipRatio', 'combinedSlip'] as const;
  static readonly STATE_SIZE = VehiclePhysics.SCALARS.length + 4 * VehiclePhysics.WHEEL.length;

  /** Writes the complete dynamic state into `out` (used by rewind). */
  saveState(out: Float64Array) {
    let i = 0;
    for (const k of VehiclePhysics.SCALARS) out[i++] = this[k];
    for (const w of this.wheels) for (const k of VehiclePhysics.WHEEL) out[i++] = w[k];
    return out;
  }

  loadState(src: Float64Array) {
    let i = 0;
    for (const k of VehiclePhysics.SCALARS) (this as any)[k] = src[i++];
    for (const w of this.wheels) for (const k of VehiclePhysics.WHEEL) (w as any)[k] = src[i++];
    this.shiftTimer = Math.max(0, this.shiftTimer);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  get gearLabel() {
    if (this.gear < 0) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }

  /** Sub-stepped update. */
  update(dt: number, input: VehicleInput) {
    const h = 1 / 480;
    let steps = Math.min(40, Math.max(1, Math.round(dt / h)));
    const sdt = dt / steps;
    this.handleShifting(input);
    while (steps--) this.step(sdt, input);
  }

  private handleShifting(input: VehicleInput) {
    const s = this.setup;
    const n = this.ratios.length;
    if (!s.autoShift && this.gear >= 0) {
      if (input.shiftUp && this.gear < n && this.shiftTimer <= 0) this.beginShift(this.gear === 0 ? 1 : this.gear + 1);
      if (input.shiftDown && this.shiftTimer <= 0) {
        if (this.gear > 1) this.beginShift(this.gear - 1);
        else if (this.vLong < 1) this.gear = -1;
      }
    } else if (!s.autoShift && this.gear < 0 && input.shiftUp) {
      this.gear = 1;
    }
  }

  private beginShift(g: number) {
    this.gear = g;
    this.shiftTimer = this.setup.shiftTime;
    this.shiftCooldown = 0.5;
  }

  private tireForces(w: Wheel, omega: number, vl: number, vt: number, Fz: number, tilt: number, out: { fx: number; fy: number; s: number; k: number; a: number }) {
    const s = this.setup;
    if (Fz <= 1) {
      out.fx = out.fy = out.s = 0;
      out.k = (omega * WHEEL_R - vl) / Math.max(Math.abs(vl), 2.5);
      out.a = 0;
      return;
    }
    const denom = Math.max(Math.abs(vl), 2.5);
    const kappa = (omega * WHEEL_R - vl) / denom;
    const alpha = Math.atan(vt / Math.max(Math.abs(vl), 2.0));
    const widthF = w.widthMm / 245;
    const pressureMul = 1 - 0.0016 * (s.tirePressure - 28) ** 2;
    // peak slip angle grows with load => cornering stiffness is sub-linear in load (heavier axle understeers)
    const loadK = Math.pow(Math.max(0.25, Fz / FZ_NOMINAL), 0.4);
    const alphaPk = 6.8 * DEG * loadK * (1 + (28 - s.tirePressure) * 0.018) * Math.pow(1 / widthF, 0.3);
    const kappaPk = 0.09 * (1 + (28 - s.tirePressure) * 0.01);
    const sx = kappa / kappaPk;
    const sy = Math.tan(alpha) / Math.tan(alphaPk);
    const sc = Math.hypot(sx, sy);
    const loadSens = Math.min(1.15, Math.max(0.72, 1 - 0.1 * (Fz / FZ_NOMINAL - 1)));
    const mu = s.tireGrip * Math.pow(widthF, 0.22) * pressureMul * loadSens * w.surface.grip;
    const F = mu * Fz * Math.sin(this.tireC * Math.atan(this.tireB * sc));
    // camber: tilt toward the force direction helps lateral grip, static camber costs longitudinal grip
    let fx = 0, fy = 0;
    if (sc > 1e-6) {
      fx = (F * sx) / sc;
      fy = (-F * sy) / sc;
      const t = tilt * Math.sign(fy);
      const latMul = Math.max(0.7, 1 + 0.035 * t - 0.0075 * t * t);
      const lonMul = Math.max(0.75, 1 - 0.008 * w.camber * w.camber);
      fx *= lonMul;
      fy *= latMul;
    }
    out.fx = fx;
    out.fy = fy;
    out.s = sc;
    out.k = kappa;
    out.a = alpha;
  }

  private tmp = { fx: 0, fy: 0, s: 0, k: 0, a: 0 };
  private tmp2 = { fx: 0, fy: 0, s: 0, k: 0, a: 0 };

  step(dt: number, input: VehicleInput) {
    const s = this.setup;
    const W = this.wheels;
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    const vxB = this.vx * sinH + this.vz * cosH;
    const vyB = this.vx * cosH - this.vz * sinH;
    const speed = Math.hypot(vxB, vyB);
    this.speed = speed;
    this.vLong = vxB;
    this.vLat = vyB;

    // ---------------------------------------------------------------- gears & pedals
    let throttle = input.throttle, brake = input.brake;
    if (this.gear < 0) {
      throttle = input.brake;
      brake = input.throttle;
      if (input.throttle > 0.3 && vxB > -0.8) { this.gear = 1; this.reverseTimer = 0; }
    } else if (input.brake > 0.3 && input.throttle < 0.05 && vxB < 0.8) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.35) { this.gear = -1; this.reverseTimer = 0; }
    } else this.reverseTimer = 0;
    this.throttleOut = throttle;
    this.brakeOut = brake;

    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;

    const n = this.ratios.length;
    const ratio = this.gear > 0 ? this.ratios[this.gear - 1] * s.finalDrive : this.gear < 0 ? -this.ratios[0] * s.finalDrive : 0;
    const driven = W.filter((w) => w.driven);
    let wAvg = 0;
    for (const w of driven) wAvg += w.omega;
    wAvg /= driven.length;
    const rpmWheel = Math.abs(wAvg * ratio) * 60 / (2 * Math.PI);

    if (s.autoShift && this.gear > 0 && this.shiftTimer <= 0 && this.shiftCooldown <= 0) {
      // decisions use road speed so wheelspin does not cause gear hunting
      const rpmRoad = Math.abs(vxB / WHEEL_R * ratio) * 60 / (2 * Math.PI);
      if (rpmWheel > s.redline * 0.965 && rpmRoad > s.redline * 0.8 && this.gear < n) this.beginShift(this.gear + 1);
      else if (this.gear > 1) {
        const lower = rpmRoad * this.ratios[this.gear - 2] / this.ratios[this.gear - 1];
        const low = Math.max(s.idleRpm * 1.6, Math.min(s.peakTorqueRpm * 0.62, s.redline * 0.55));
        if ((rpmRoad < low || (brake > 0.5 && lower < s.redline * 0.78)) && lower < s.redline * 0.88) this.beginShift(this.gear - 1);
      }
    }

    const engaged = this.gear !== 0 && this.shiftTimer <= 0;
    const launchRpm = Math.max(s.idleRpm + 800, s.peakTorqueRpm * 0.7);
    let engineRpm: number;
    this.clutchSlip = false;
    if (engaged) {
      const minRpm = s.idleRpm + throttle * (launchRpm - s.idleRpm);
      if (rpmWheel < minRpm) {
        engineRpm = minRpm;
        this.clutchSlip = true;
      } else engineRpm = rpmWheel;
    } else {
      const target = s.idleRpm + throttle * (s.redline - s.idleRpm) * 0.9;
      engineRpm = this.rpm + (target - this.rpm) * Math.min(1, dt * 6);
    }
    this.rpm = Math.min(engineRpm, s.redline + 150);

    let engineT = 0;
    if (engaged) {
      if (this.rpm < s.redline) engineT = throttle * engineTorqueCurve(s, this.rpm);
      if (!this.clutchSlip) engineT -= (1 - throttle) * s.engineBraking * engineTorqueCurve(s, this.rpm) * 0.28 * (this.rpm / s.redline);
    }
    // traction control
    let maxSlip = 0, maxCombined = 0;
    for (const w of driven) {
      maxSlip = Math.max(maxSlip, w.slipRatio * Math.sign(ratio || 1));
      maxCombined = Math.max(maxCombined, w.combinedSlip);
    }
    // traction control also watches combined (lateral + longitudinal) slip, so it catches power oversteer
    const slipping = maxSlip > 0.1 || (maxCombined > 1.02 && speed > 5);
    const sliding = this.assist.stability > 0 && speed > 5 && Math.abs(Math.atan2(vyB, Math.abs(vxB))) > 0.12;
    if ((s.tcs || this.assist.tcs) && engineT > 0 && (slipping || sliding) && speed > 1) {
      this.tcsCut = Math.max(0.15, this.tcsCut - dt * 12);
      this.tcsActive = true;
    } else {
      this.tcsCut = Math.min(1, this.tcsCut + dt * 4);
      if (this.tcsCut > 0.98) this.tcsActive = false;
    }
    if (engineT > 0) engineT *= this.tcsCut;
    const shaftT = engaged ? engineT * ratio * 0.92 : 0;
    const reflected = engaged && !this.clutchSlip ? (s.engineInertia * ratio * ratio) / driven.length : 0;

    const frontShare = s.drivetrain === 'FWD' ? 1 : s.drivetrain === 'RWD' ? 0 : s.awdFrontSplit;
    const axleT = [shaftT * frontShare, shaftT * (1 - frontShare)];

    // ---------------------------------------------------------------- steering
    const target = Math.max(-1, Math.min(1, input.steer));
    const returning = Math.abs(target) < Math.abs(this.steerPos) || Math.sign(target) !== Math.sign(this.steerPos);
    const rate = s.steerSpeed * (returning ? 1 + s.caster / 6 : 1) * dt;
    this.steerPos += Math.max(-rate, Math.min(rate, target - this.steerPos));
    const speedFactor = Math.max(0.16, 1 / (1 + s.steerSensitivity * Math.max(0, speed - 4) / 11));
    let delta = this.steerPos * s.steerLock * DEG * speedFactor;
    const A = this.assist;
    if (A.steerLimit && speed > 5) {
      // steering angle that already saturates the fronts: kinematic angle for max lateral accel + peak slip angle
      const mu = s.tireGrip * (1 + this.downforce / (this.m * G));
      const lim = (s.wheelbase * mu * G) / (speed * speed) + 5.5 * DEG;
      delta = Math.max(-lim, Math.min(lim, delta));
    }
    if (A.counterSteer > 0 && speed > 4 && vxB > 0) {
      const beta = Math.atan2(vyB, vxB);
      if (Math.abs(beta) > 0.03) delta += A.counterSteer * (beta - Math.sign(beta) * 0.03);
    }
    delta = Math.max(-s.steerLock * DEG, Math.min(s.steerLock * DEG, delta));
    this.steerAngle = delta;
    const wb = s.wheelbase;
    let dL = delta, dR = delta;
    if (Math.abs(delta) > 1e-4) {
      const R = wb / Math.tan(Math.abs(delta));
      const inner = Math.atan(wb / Math.max(0.5, R - this.tw / 2));
      const outer = Math.atan(wb / (R + this.tw / 2));
      const sg = Math.sign(delta);
      const innerA = Math.abs(delta) + s.ackermann * (inner - Math.abs(delta));
      const outerA = Math.abs(delta) + s.ackermann * (outer - Math.abs(delta));
      if (delta > 0) { dL = sg * innerA; dR = sg * outerA; } else { dR = sg * innerA; dL = sg * outerA; }
    }
    W[0].steer = dL + W[0].toe;
    W[1].steer = dR + W[1].toe;
    W[2].steer = W[2].toe;
    W[3].steer = W[3].toe;

    // ---------------------------------------------------------------- aero
    const v2 = speed * speed;
    const avgRh = (s.rideHeightF + s.rideHeightR) / 2 - 1000 * this.heave;
    const ground = Math.min(1.45, Math.max(0.75, 1 + 0.45 * (100 - avgRh) / 100));
    const rake = 1 + (s.rideHeightR - s.rideHeightF) / 250;
    const dfF = 0.5 * RHO * v2 * s.downforceF * ground * rake;
    const dfR = 0.5 * RHO * v2 * s.downforceR * ground;
    this.downforce = dfF + dfR;
    const drag = 0.5 * RHO * v2 * (s.dragCd * FRONTAL_AREA + 0.1 * (s.downforceF + s.downforceR));

    // ---------------------------------------------------------------- suspension loads
    this.scraping = false;
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const l = w.x, sd = w.y;
      w.compression = w.c0 + this.heave + this.pitch * l + this.roll * sd;
      w.compVel = this.heaveV + this.pitchV * l + this.rollV * sd;
    }
    const arbDiffF = W[0].compression - W[1].compression;
    const arbDiffR = W[2].compression - W[3].compression;
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const disp = w.compression - w.c0;
      let f = w.k * w.compression;
      f += w.compVel > 0 ? w.cBump * w.compVel : w.cRebound * w.compVel;
      const arb = (w.front ? s.arbF : s.arbR) * 1000;
      const diff = w.front ? arbDiffF : arbDiffR;
      f += (w.left ? 1 : -1) * arb * diff;
      const over = disp - w.travel;
      if (over > 0) f += w.k * 30 * over + 8000 * Math.max(0, w.compVel);
      w.load = Math.max(0, f);
      const clear = w.rideHeight - disp;
      w.chassisForce = 0;
      if (clear < 0.012) {
        w.chassisForce = 600000 * (0.012 - clear) + 20000 * Math.max(0, w.compVel);
        this.scraping = true;
      }
    }

    // ---------------------------------------------------------------- tires & wheels
    const fwd = { x: sinH, z: cosH }, left = { x: cosH, z: -sinH };
    let Fx = 0, Fy = 0, Mz = 0;
    this.absActive = false;
    const rollDeg = this.roll / DEG; // body roll angle (+ = leaning left)
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      w.worldX = this.x + fwd.x * w.x + left.x * w.y;
      w.worldZ = this.z + fwd.z * w.x + left.z * w.y;
      w.surface = this.surfaceFn(w.worldX, w.worldZ, i);

      const vwx = vxB - this.yawRate * w.y;
      const vwy = vyB + this.yawRate * w.x;
      const cd = Math.cos(w.steer), sd = Math.sin(w.steer);
      const vl = vwx * cd + vwy * sd;
      const vt = -vwx * sd + vwy * cd;

      // camber tilt toward +y (left) in degrees
      const inward = w.left ? -1 : 1;
      let tilt = inward * -w.camber + rollDeg * 0.55; // wheels lean with the body
      if (w.front) tilt += s.caster * (w.steer - w.toe) * 0.9;

      // drive / brake torques
      const axle = w.front ? 0 : 1;
      let Td = w.driven ? axleT[axle] / 2 : 0;
      let Tb = brake * s.brakeTorque * (w.front ? s.brakeBias : 1 - s.brakeBias) / 2;
      if (!w.front) Tb += input.handbrake * s.handbrakeTorque / 2;
      w.absActive = false;
      if ((s.abs || this.assist.abs) && brake > 0.05 && w.slipRatio < -0.11 && Math.abs(vl) > 2) {
        Tb *= 0.15;
        w.absActive = true;
        this.absActive = true;
      }
      Tb += (0.013 + w.surface.rolling) * w.load * WHEEL_R;
      const I = w.inertia + (w.driven ? reflected : 0);

      const o = this.tmp;
      this.tireForces(w, w.omega, vl, vt, w.load, tilt, o);
      const eps = 0.05;
      this.tireForces(w, w.omega + eps, vl, vt, w.load, tilt, this.tmp2);
      const kf = Math.max(0, (this.tmp2.fx - o.fx) / eps);
      const den = 1 + (dt * WHEEL_R * kf) / I;
      const wA = w.omega + (dt * (Td - WHEEL_R * o.fx)) / I / den;
      const bD = (dt * Tb) / I / den;
      w.omega = Math.abs(wA) <= bD ? 0 : wA - Math.sign(wA) * bD;
      // re-evaluate with new spin for consistent force
      this.tireForces(w, w.omega, vl, vt, w.load, tilt, o);
      w.fx = o.fx;
      w.fy = o.fy;
      w.slipRatio = o.k;
      w.slipAngle = o.a;
      w.combinedSlip = o.s;
      w.bodyFx = w.fx * cd - w.fy * sd;
      w.bodyFy = w.fx * sd + w.fy * cd;
      Fx += w.bodyFx;
      Fy += w.bodyFy;
      Mz += w.x * w.bodyFy - w.y * w.bodyFx;
    }

    // differentials: implicit torque transfer between wheels of the same axle
    const lockAxle = (a: Wheel, b: Wheel, T: number) => {
      const d = a.omega - b.omega;
      if (Math.abs(d) < 1e-6) return;
      const I = a.inertia + reflected;
      const need = (Math.abs(d) / 2) * I / dt;
      let cap = 0;
      if (s.diffType === 'locked') cap = Infinity;
      else if (s.diffType === 'lsd') cap = s.lsdPreload + s.lsdLock * Math.abs(T);
      const t = Math.min(need, cap);
      const dw = (t * dt) / I * Math.sign(d);
      a.omega -= dw;
      b.omega += dw;
    };
    if (W[0].driven) lockAxle(W[0], W[1], axleT[0]);
    if (W[2].driven) lockAxle(W[2], W[3], axleT[1]);

    for (const w of W) w.spin += w.omega * dt;

    // ---------------------------------------------------------------- body forces
    if (speed > 0.01) {
      Fx -= drag * (vxB / speed);
      Fy -= drag * (vyB / speed);
    }
    let chassisTotal = 0;
    for (const w of W) chassisTotal += w.chassisForce;
    if (chassisTotal > 0 && speed > 0.05) {
      Fx -= 0.6 * chassisTotal * (vxB / speed);
      Fy -= 0.6 * chassisTotal * (vyB / speed);
    }
    // stability assist: damp yaw rate beyond the kinematic target
    const stab = Math.max(s.stability, this.assist.stability);
    if (stab > 0 && speed > 3) {
      // allowed yaw band: from zero up to the kinematic target (plus a little), in the steered direction only
      const target = (vxB * Math.tan(delta)) / wb;
      const lo = Math.min(0, target) - 0.12, hi = Math.max(0, target) + 0.12;
      const excess = this.yawRate - Math.max(lo, Math.min(hi, this.yawRate));
      Mz -= stab * 6 * this.Iz * excess;
    }
    // tiny yaw damping for numerical calm at rest
    if (speed < 1) Mz -= this.yawRate * this.Iz * 2;

    const m = this.m;
    const axB = Fx / m, ayB = Fy / m;
    this.accLong = axB;
    this.accLat = ayB;
    this.vx += (axB * sinH + ayB * cosH) * dt;
    this.vz += (axB * cosH - ayB * sinH) * dt;
    this.yawRate += (Mz / this.Iz) * dt;
    // standstill friction: stop creeping when no drive and slow
    const sp = Math.hypot(this.vx, this.vz);
    if (sp < 0.25 && throttle < 0.02 && (brake > 0.1 || input.handbrake > 0.1)) {
      this.vx *= 0.8;
      this.vz *= 0.8;
      this.yawRate *= 0.8;
    }
    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // ---------------------------------------------------------------- body pitch / roll / heave
    let sumF = 0, pitchM = 0, rollM = 0;
    for (const w of W) {
      const f = w.load + w.chassisForce;
      sumF += f;
      pitchM -= f * w.x;
      rollM -= f * w.y;
    }
    const h = this.cogH;
    pitchM += dfF * this.a - dfR * this.b - Fx * h;
    rollM += -Fy * h;
    const heaveA = (m * G + dfF + dfR - sumF) / m;
    this.heaveV += heaveA * dt;
    this.pitchV += (pitchM / this.Ip) * dt;
    this.rollV += (rollM / this.Ir) * dt;
    this.heave += this.heaveV * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;
  }

}

export interface PerfStats {
  zeroTo100: number;
  zeroTo200: number;
  topSpeed: number; // km/h
  brake100: number; // m
  lateralG: number;
}

/** Headless straight-line / skidpad simulation used by the garage stats. */
export function simulatePerformance(setup: CarSetup): PerfStats {
  const p = new VehiclePhysics({ ...setup, autoShift: true });
  p.reset(0, 0, 0);
  const dt = 1 / 120;
  let t = 0, t100 = NaN, t200 = NaN, top = 0, stall = 0;
  const inp: VehicleInput = { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
  while (t < 90) {
    p.update(dt, inp);
    t += dt;
    const kmh = p.speed * 3.6;
    if (isNaN(t100) && kmh >= 100) t100 = t;
    if (isNaN(t200) && kmh >= 200) t200 = t;
    if (kmh > top + 0.05) { top = kmh; stall = 0; } else stall += dt;
    if (stall > 4) break;
  }
  // braking from 100 km/h
  const b = new VehiclePhysics(setup);
  b.reset(0, 0, 0);
  b.vz = 100 / 3.6;
  for (const w of b.wheels) w.omega = b.vz / WHEEL_R;
  b.gear = 3;
  let dist = 0;
  const brk: VehicleInput = { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
  for (let i = 0; i < 60 * 30 && (i === 0 || b.speed > 0.3); i++) {
    const z0 = b.z;
    b.update(1 / 60, brk);
    dist += b.z - z0;
  }
  // steady state lateral grip estimate at 80 km/h on a 60 m radius
  const c = new VehiclePhysics({ ...setup, stability: 0 });
  c.reset(0, 0, 0);
  const v0 = 80 / 3.6;
  c.vz = v0;
  for (const w of c.wheels) w.omega = v0 / WHEEL_R;
  c.gear = 3;
  let maxG = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const err = v0 - c.speed;
    c.update(1 / 60, { throttle: Math.max(0, Math.min(1, err * 0.5 + 0.35)), brake: 0, steer: Math.min(1, i / 60), handbrake: 0 });
    if (i > 120) maxG = Math.max(maxG, Math.abs(c.accLat) / G);
  }
  return { zeroTo100: t100, zeroTo200: t200, topSpeed: top, brake100: dist, lateralG: maxG };
}
