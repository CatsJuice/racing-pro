import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CarVisual } from '../car/carVisual';
import type { CarSetup } from '../car/setup';
import { getAssets, part } from '../render/assets';
import { Environment } from '../render/environment';
import { getStage, toon, toonify, viewSize } from '../render/toon';

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
  /** vertical shift of the car in screen space (fraction of height, + = up) */
  offsetY = 0;
  private spin = 0;

  constructor(opts: { interactive?: boolean } = {}) {
    // Studio lighting is fixed (warm afternoon key light); the race's time of day doesn't apply here.
    this.env = new Environment(this.scene, { shadowSize: 10, hour: 15.3 });
    this.env.sky.visible = false;
    this.buildStudio();
    this.scene.add(this.turntable);

    // two cones at the edge of the pool of light for scale
    const A = getAssets();
    for (const [x, z, r] of [[6.4, -2.2, 0], [7.1, -3.3, 0.6]]) {
      const o = part(A.scenery, 'cone');
      toonify(o);
      o.position.set(x, 0, z);
      o.rotation.y = r;
      o.scale.setScalar(1.15);
      o.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).castShadow = true; });
      this.scene.add(o);
    }
    this.camera.fov = 30;
    this.camera.position.set(9.6, 2.9, 10.6);
    this.camera.lookAt(0, 0.8, 0);
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

  /**
   * Infinite cyclorama: a gradient backdrop dome whose horizon colour matches the fog, so the
   * floor dissolves into it without a visible edge. On the floor: a light pool, a faint
   * measuring grid and a neon-edged graphite turntable.
   */
  private buildStudio() {
    const TOP = new THREE.Color('#0f1633'), HORIZON = new THREE.Color('#3b4aa6'), GLOW = new THREE.Color('#8a7dff');
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: TOP }, horizon: { value: HORIZON }, glow: { value: GLOW } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir);
            vec3 col = mix(horizon, top, smoothstep(0.0, 0.55, d.y));
            // soft key-light bloom high on the backdrop; faded to nothing at the horizon so the
            // floor (which fogs into exactly \`horizon\`) meets the sky without a seam
            float g = max(dot(d, normalize(vec3(-0.5, 0.45, -1.0))), 0.0);
            col += glow * pow(g, 5.0) * 0.4 * smoothstep(0.02, 0.25, d.y);
            col = mix(col, horizon, smoothstep(0.04, -0.1, d.y));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    dome.userData.noOutline = true;
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    this.scene.add(dome);
    this.scene.fog = new THREE.Fog(HORIZON, 14, 90);

    // big enough that its rim lies beyond the ink pass's fade distance (no outline at the horizon)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2600, 64), toon('#28336f'));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData.noOutline = true;
    this.scene.add(floor);

    const decal = (tex: THREE.Texture, size: number, y: number, opts: THREE.MeshBasicMaterialParameters = {}) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, ...opts }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.userData.noOutline = true;
      return m;
    };
    this.scene.add(decal(floorGridTexture(), 60, 0.005, { opacity: 0.55 }));
    this.scene.add(decal(radialTexture('rgba(150,170,255,0.35)', 'rgba(150,170,255,0)'), 24, 0.01, { blending: THREE.AdditiveBlending }));

    // turntable: graphite disc, inset neon ring, lit edge band and a warm under-glow
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.35, 0.22, 96), toon('#262d4d'));
    disc.position.y = 0.11;
    disc.receiveShadow = true;
    disc.castShadow = true;
    const top = new THREE.Mesh(new THREE.CircleGeometry(4.2, 96), new THREE.MeshBasicMaterial({ map: turntableTexture(), transparent: true, depthWrite: false }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.222;
    top.userData.noOutline = true;
    const neon = new THREE.Mesh(new THREE.RingGeometry(3.86, 3.98, 128), new THREE.MeshBasicMaterial({ color: '#ffd23f', side: THREE.DoubleSide }));
    neon.rotation.x = -Math.PI / 2;
    neon.position.y = 0.224;
    neon.userData.noOutline = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(4.36, 4.36, 0.05, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#62d6ff' }));
    band.position.y = 0.03;
    band.userData.noOutline = true;
    this.turntable.add(disc, top, neon, band);
    this.scene.add(decal(radialTexture('rgba(98,214,255,0.5)', 'rgba(98,214,255,0)'), 12, 0.008, { blending: THREE.AdditiveBlending }));

    // cool rim light from behind to separate the car from the backdrop
    const rim = new THREE.DirectionalLight('#9fb4ff', 1.3);
    rim.position.set(-6, 5, -9);
    this.scene.add(rim);
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
    const { w: W, h: H } = viewSize();
    this.camera.clearViewOffset();
    if (this.offsetX || this.offsetY) this.camera.setViewOffset(W, H, -this.offsetX * W, this.offsetY * H, W, H);
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

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function radialTexture(inner: string, outer: string) {
  return canvasTexture(256, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** 1 m grid lines that fade out radially. */
function floorGridTexture() {
  return canvasTexture(1024, (ctx, s) => {
    const cells = 60, step = s / cells;
    ctx.strokeStyle = 'rgba(190, 205, 255, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= cells; i++) {
      ctx.moveTo(i * step, 0); ctx.lineTo(i * step, s);
      ctx.moveTo(0, i * step); ctx.lineTo(s, i * step);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Turntable top: fine concentric grooves and radial tick marks around the rim. */
function turntableTexture() {
  return canvasTexture(1024, (ctx, s) => {
    const c = s / 2;
    // brushed-metal sheen: a soft conic highlight rather than hard grooves
    const sheen = ctx.createConicGradient(0.6, c, c);
    sheen.addColorStop(0, 'rgba(255,255,255,0.0)');
    sheen.addColorStop(0.12, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(0.25, 'rgba(255,255,255,0.0)');
    sheen.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(0.75, 'rgba(255,255,255,0.0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.93, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2, long = i % 10 === 0;
      const r0 = c * (long ? 0.95 : 0.965), r1 = c * 0.99;
      ctx.lineWidth = long ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      ctx.stroke();
    }
  });
}
