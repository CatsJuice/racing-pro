import * as THREE from 'three';
import { getAssets, part } from '../render/assets';
import { toonify } from '../render/toon';
import type { CarSetup } from './setup';

const MODEL_WB = 2.6;
const MODEL_TW = 1.6;
const WHEEL_R = 0.32;

export interface CarPose {
  x: number;
  z: number;
  heading: number;
  pitch: number; // rad, + nose down
  roll: number; // rad, + left side down
  heave: number; // m compression
  steer: number; // front wheel angle rad
  wheelSpin: number[]; // 4 accumulated angles (or single value replicated)
  brake: number;
}

/**
 * Cartoon car assembled from the Blender models. Geometry adapts to the setup:
 * wheelbase/track move the wheels, ride height lifts the body, aero changes the
 * splitter/wing, tire width scales the wheels, camber tilts them.
 */
export class CarVisual {
  root = new THREE.Group();
  private bodyPivot = new THREE.Group();
  private body = new THREE.Group();
  private wheelSteer: THREE.Group[] = [];
  private wheelSpin: THREE.Group[] = [];
  private wheelTilt: THREE.Group[] = [];
  private wing!: THREE.Object3D;
  private wingMount!: THREE.Object3D;
  private splitter!: THREE.Object3D;
  private mats = new Map<string, THREE.Material>();
  private setup!: CarSetup;
  private a = 1.3;
  private b = 1.3;
  private cog = 0.5;
  /** exaggerate body motion for a cartoon feel */
  motionScale = 2.2;

  constructor(setup: CarSetup, opts: { ghost?: boolean; ghostColor?: string } = {}) {
    const A = getAssets();
    const bodyParts = ['CarBody', 'Splitter', 'WingBlade', 'WingMount'].map((n) => part(A.car, n));
    [, this.splitter, this.wing, this.wingMount] = bodyParts;
    bodyParts.forEach((p) => this.body.add(p));
    this.bodyPivot.add(this.body);
    this.root.add(this.bodyPivot);

    for (let i = 0; i < 4; i++) {
      const steer = new THREE.Group();
      const tilt = new THREE.Group();
      const spin = new THREE.Group();
      const wheel = part(A.wheel, 'Wheel');
      const caliper = part(A.wheel, 'Caliper');
      const right = i % 2 === 1;
      if (right) {
        wheel.rotation.y = Math.PI;
        caliper.rotation.y = Math.PI;
        caliper.rotation.x = 0;
      }
      spin.add(wheel);
      tilt.add(spin);
      tilt.add(caliper);
      steer.add(tilt);
      this.root.add(steer);
      this.wheelSteer.push(steer);
      this.wheelTilt.push(tilt);
      this.wheelSpin.push(spin);
    }
    this.mats = toonify(this.root, { Paint: setup.color, Stripe: setup.accent });
    if (opts.ghost) this.makeGhost(opts.ghostColor ?? '#7fd8ff');
    this.applySetup(setup);
  }

  private makeGhost(color: string) {
    const ghostMat = new THREE.MeshToonMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false });
    (ghostMat.userData as any).outlineParameters = { visible: false };
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = ghostMat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
  }

  applySetup(s: CarSetup) {
    this.setup = s;
    this.a = s.wheelbase * (1 - s.frontWeight);
    this.b = s.wheelbase * s.frontWeight;
    this.cog = s.cogHeight;
    const sx = THREE.MathUtils.clamp(s.trackWidth / MODEL_TW, 0.9, 1.12);
    const sz = THREE.MathUtils.clamp(s.wheelbase / MODEL_WB, 0.88, 1.15);
    this.body.scale.set(sx, 1, sz);
    this.body.position.z = (this.a - this.b) / 2;
    const tint = (name: string, c: string) => {
      const m = this.mats.get(name) as THREE.MeshToonMaterial | undefined;
      if (m && !m.transparent) m.color.set(c);
    };
    tint('Paint', s.color);
    tint('Stripe', s.accent);

    for (let i = 0; i < 4; i++) {
      const front = i < 2, left = i % 2 === 0;
      const w = this.wheelSteer[i];
      w.position.set((left ? 1 : -1) * s.trackWidth / 2, WHEEL_R, front ? this.a : -this.b);
      const width = (front ? s.tireWidthF : s.tireWidthR) / 245;
      this.wheelSpin[i].scale.set(width, 1, 1);
      // camber: negative = top inward; left wheel top inward = toward -X => rotate about Z
      const camber = THREE.MathUtils.degToRad(front ? s.camberF : s.camberR);
      this.wheelTilt[i].rotation.z = (left ? -1 : 1) * camber;
    }
    const hasWing = s.downforceR > 0.04;
    this.wing.visible = this.wingMount.visible = hasWing;
    this.wing.rotation.x = THREE.MathUtils.clamp(s.downforceR * 0.16, 0, 0.36);
    this.wing.scale.set(1, 0.8 + Math.min(1, s.downforceR / 2) * 0.4, 1);
    this.splitter.visible = s.downforceF > 0.04;
    this.splitter.scale.set(1, 1, 0.6 + Math.min(1.6, s.downforceF) * 0.5);
  }

  update(p: CarPose) {
    const s = this.setup;
    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = p.heading;
    const ride = ((s.rideHeightF + s.rideHeightR) / 2 - 100) / 1000;
    const rake = ((s.rideHeightR - s.rideHeightF) / 1000) / s.wheelbase;
    const k = this.motionScale;
    this.bodyPivot.position.set(0, this.cog + ride - p.heave * k, 0);
    this.body.position.y = -this.cog;
    this.bodyPivot.rotation.set(p.pitch * k + rake, 0, -p.roll * k, "YXZ");
    for (let i = 0; i < 4; i++) {
      this.wheelSteer[i].rotation.y = i < 2 ? p.steer : 0;
      this.wheelSpin[i].rotation.x = p.wheelSpin[i] ?? p.wheelSpin[0];
    }
    const tail = this.mats.get('TailLight') as THREE.MeshToonMaterial | undefined;
    if (tail && tail.emissive) tail.emissiveIntensity = 0.35 + p.brake * 1.6;
  }

  dispose() {
    this.root.removeFromParent();
    this.mats.forEach((m) => m.dispose());
  }
}
