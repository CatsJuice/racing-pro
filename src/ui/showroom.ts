import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CarVisual } from '../car/carVisual';
import type { CarSetup } from '../car/setup';
import { getAssets, part } from '../render/assets';
import { getPrefs } from '../core/storage';
import { Environment } from '../render/environment';
import { getStage, toon, toonify } from '../render/toon';

/** Turntable scene for the menu and garage. */
export class Showroom {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 3000);
  car: CarVisual | null = null;
  controls: OrbitControls | null = null;
  private turntable = new THREE.Group();
  autoRotate = true;
  env: Environment;
  /** horizontal shift of the car in screen space (fraction of width) */
  offsetX = 0;
  private spin = 0;

  constructor(opts: { interactive?: boolean } = {}) {
    this.env = new Environment(this.scene, { shadowSize: 12, hour: getPrefs().hour ?? 16.8 });
    this.scene.fog = new THREE.Fog('#d8f0ff', 60, 420);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2200, 64), toon('#8fd765'));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const plat = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.25, 64), toon('#f4f4f4'));
    plat.position.y = 0.125;
    plat.receiveShadow = true;
    plat.castShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.09, 8, 64), toon('#ffd23f'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    const stripe = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 64), toon('#e63946', { side: THREE.DoubleSide }));
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.y = 0.255;
    this.turntable.add(plat, ring, stripe);
    this.scene.add(this.turntable);

    // a few props for flavour
    const A = getAssets();
    const props: [string, number, number, number, number][] = [
      ['tree_pine', -30, -4, 0, 1.3], ['tree_round', 16, -26, 1, 1.4], ['tree_pine', 26, -6, 2, 1.1], ['bush', -14, 2, 0, 1.2],
      ['tire_stack', 6.5, -4, 0, 1], ['tire_stack', 7.4, -2.8, 0, 1], ['cone', -6, 3, 0, 1.3], ['cone', -6.8, 1.6, 0, 1.3],
      ['tree_round', -34, -30, 2, 1.6], ['billboard', -12, -44, 0.5, 1.4], ['balloon', -40, -120, 0, 2.2], ['cloud', 60, -200, 0, 5], ['cloud', -90, -220, 1, 4],
    ];
    for (const [n, x, z, r, s] of props) {
      const o = part(A.scenery, n);
      toonify(o);
      o.position.set(x, n === 'cloud' ? 90 : n === 'balloon' ? 30 : 0, z);
      o.rotation.y = r;
      o.scale.setScalar(s);
      this.scene.add(o);
    }
    this.camera.position.set(7.5, 3.2, 8.5);
    this.camera.lookAt(0, 0.7, 0);
    if (opts.interactive) {
      const c = (this.controls = new OrbitControls(this.camera, getStage().renderer.domElement));
      c.target.set(0, 0.7, 0);
      c.enableDamping = true;
      c.minDistance = 5;
      c.maxDistance = 18;
      c.maxPolarAngle = Math.PI * 0.49;
      c.enablePan = false;
      c.addEventListener('start', () => (this.autoRotate = false));
    }
  }

  setCar(setup: CarSetup) {
    if (this.car) this.car.dispose();
    this.car = new CarVisual(setup);
    this.car.motionScale = 1;
    this.turntable.add(this.car.root);
    this.car.root.position.y = 0.25;
    this.pose();
  }

  updateSetup(setup: CarSetup) {
    this.car?.applySetup(setup);
    this.pose();
  }

  private pose() {
    this.car?.update({ x: 0, z: 0, heading: 0, pitch: 0, roll: 0, heave: 0, steer: 0.25, wheelSpin: [0, 0, 0, 0], brake: 0 });
    if (this.car) this.car.root.position.y = 0.25;
  }

  render(dt: number) {
    if (this.autoRotate) this.spin += dt * 0.35;
    this.turntable.rotation.y = this.spin;
    this.controls?.update();
    const stage = getStage();
    const W = window.innerWidth, H = window.innerHeight;
    this.camera.clearViewOffset();
    if (this.offsetX) this.camera.setViewOffset(W, H, -this.offsetX * W, 0, W, H);
    this.env.update(dt, performance.now() / 1000);
    stage.post.dofStrength = 0;
    stage.render(this.scene, this.camera, this.env);
  }

  dispose() {
    this.controls?.dispose();
    this.car?.dispose();
    this.scene.clear();
  }
}
