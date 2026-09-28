import * as THREE from 'three';

/**
 * Time-of-day system: sky, sun/moon light, hemisphere ambient (which tints the
 * shadows), fog, stars and night lighting of emissive props.
 */

interface Key {
  h: number;
  top: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  grade: string; // multiplied into the final image
}

const KEYS: Key[] = [
  { h: 0, top: '#080c26', horizon: '#2a2750', sun: '#aab8ff', sunI: 0.8, hemiSky: '#525a90', hemiGround: '#2c2838', hemiI: 1.0, grade: '#dde0f2' },
  { h: 4.8, top: '#0e1336', horizon: '#3e3262', sun: '#aab8ff', sunI: 0.7, hemiSky: '#585d92', hemiGround: '#2f2a3c', hemiI: 1.0, grade: '#e0e1f2' },
  { h: 5.8, top: '#3b3f8f', horizon: '#ff9a76', sun: '#ff8a5c', sunI: 0.9, hemiSky: '#8a74d6', hemiGround: '#6a3a58', hemiI: 0.85, grade: '#ffd9d0' },
  { h: 7.2, top: '#5f9df5', horizon: '#ffd2a6', sun: '#ffcf96', sunI: 1.9, hemiSky: '#a7b6ff', hemiGround: '#8a6a50', hemiI: 0.95, grade: '#fff0e2' },
  { h: 12, top: '#3f9bff', horizon: '#cfeaff', sun: '#fff1d6', sunI: 2.4, hemiSky: '#b5c6ff', hemiGround: '#7c8a55', hemiI: 1.0, grade: '#ffffff' },
  { h: 16, top: '#4f86e6', horizon: '#ffd9a8', sun: '#ffc27a', sunI: 2.3, hemiSky: '#b4a8f5', hemiGround: '#a8805a', hemiI: 1.1, grade: '#fff0dc' },
  { h: 17.6, top: '#5a68c8', horizon: '#ff9d5c', sun: '#ff9a50', sunI: 2.3, hemiSky: '#ab8ff0', hemiGround: '#b06a50', hemiI: 1.15, grade: '#ffe6d2' },
  { h: 18.7, top: '#3a3486', horizon: '#ff5e62', sun: '#ff6a42', sunI: 1.5, hemiSky: '#9274e0', hemiGround: '#7a4064', hemiI: 1.1, grade: '#ffd8d8' },
  { h: 19.6, top: '#1a1a52', horizon: '#6a3f86', sun: '#a4aaff', sunI: 0.75, hemiSky: '#605c9e', hemiGround: '#382c4c', hemiI: 1.0, grade: '#e2dcf6' },
  { h: 24, top: '#080c26', horizon: '#2a2750', sun: '#aab8ff', sunI: 0.8, hemiSky: '#525a90', hemiGround: '#2c2838', hemiI: 1.0, grade: '#dde0f2' },
];

export const TIME_PRESETS: { label: string; h: number }[] = [
  { label: '清晨', h: 6.4 },
  { label: '上午', h: 9.5 },
  { label: '正午', h: 12.5 },
  { label: '黄昏', h: 17.8 },
  { label: '夜晚', h: 22 },
];

const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function lerpColor(a: string, b: string, k: number, out: THREE.Color) {
  return out.copy(tmpA.set(a)).lerp(tmpB.set(b), k);
}

export function hourLabel(h: number) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export class Environment {
  sky: THREE.Mesh;
  sun = new THREE.DirectionalLight('#fff4dc', 2.2);
  hemi = new THREE.HemisphereLight('#dff1ff', '#6b8f4e', 1.1);
  hour = 12;
  /** hours advanced per real second (0 = frozen) */
  speed = 0;
  /** 0 = full day .. 1 = full night */
  night = 0;
  grade = new THREE.Color(1, 1, 1);
  sunDir = new THREE.Vector3(0, 1, 0);
  private skyU: Record<string, THREE.IUniform>;
  private fog: THREE.Fog;
  private glowMats: { m: THREE.MeshToonMaterial; base: number; day: number; night: number }[] = [];
  private cloudMats: THREE.MeshToonMaterial[] = [];
  private focus = new THREE.Vector3();

  constructor(private scene: THREE.Scene, opts: { shadowSize?: number; hour?: number } = {}) {
    this.skyU = {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color() },
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      night: { value: 0 },
      time: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyU,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,1.)).xyz - cameraPosition); gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 moonDir;
          uniform float night; uniform float time;
          varying vec3 vDir;
          float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          void main(){
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(horizon, top, smoothstep(-0.05, 0.55, h));
            col = mix(col, horizon * 0.8, smoothstep(0.0, -0.3, h));
            // sun disc + warm halo
            float s = max(dot(d, normalize(sunDir)), 0.0);
            col += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.12) * (1.0 - night);
            // moon
            float m = max(dot(d, normalize(moonDir)), 0.0);
            col += vec3(0.85, 0.9, 1.1) * (smoothstep(0.9993, 0.9996, m) * 1.6 + pow(m, 40.0) * 0.12) * night;
            // stars
            vec3 g = floor(d * 380.0);
            float st = step(0.9965, hash(g)) * smoothstep(0.05, 0.35, h);
            st *= 0.6 + 0.4 * sin(time * 3.0 + hash(g + 7.0) * 40.0);
            col += vec3(st) * night * 1.4;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.sky.userData.noOutline = true;
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.fog = new THREE.Fog('#d8f0ff', 420, 2600);
    scene.fog = this.fog;
    scene.add(this.hemi);
    const S = opts.shadowSize ?? 60;
    const sh = this.sun.shadow;
    this.sun.castShadow = true;
    sh.camera.left = -S; sh.camera.right = S; sh.camera.top = S; sh.camera.bottom = -S;
    sh.camera.near = 10; sh.camera.far = 700;
    sh.mapSize.set(2048, 2048);
    sh.bias = -0.0004;
    sh.normalBias = 0.02;
    sh.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.setHour(opts.hour ?? 12);
  }

  /** Collect emissive / cloud materials so night lighting can be applied. Call after the scene is built. */
  collect(root: THREE.Object3D = this.scene) {
    this.glowMats = [];
    this.cloudMats = [];
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const mm = (o as THREE.Mesh).material;
      if (!mm) return;
      for (const m of Array.isArray(mm) ? mm : [mm]) {
        if (seen.has(m)) continue;
        seen.add(m);
        const n = m.name;
        if (n === 'Cloud') this.cloudMats.push(m as THREE.MeshToonMaterial);
        const t = m as THREE.MeshToonMaterial;
        if (/^(LanternLight|FloodLight|HeadLight|DrlLight)$/.test(n) && t.emissive) {
          t.userData.baseEI ??= t.emissiveIntensity;
          this.glowMats.push({ m: t, base: t.userData.baseEI, day: n === 'DrlLight' ? 1 : 0.35, night: n === 'HeadLight' ? 3.5 : 2.6 });
        }
      }
    });
    this.applyNight();
  }

  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24;
    const H = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= H) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const k = (H - a.h) / (b.h - a.h);
    const u = this.skyU;
    lerpColor(a.top, b.top, k, u.top.value);
    lerpColor(a.horizon, b.horizon, k, u.horizon.value);
    const sunCol = lerpColor(a.sun, b.sun, k, new THREE.Color());
    this.fog.color.copy(u.horizon.value).lerp(u.top.value, 0.25);
    this.hemi.color.copy(lerpColor(a.hemiSky, b.hemiSky, k, new THREE.Color()));
    this.hemi.groundColor.copy(lerpColor(a.hemiGround, b.hemiGround, k, new THREE.Color()));
    this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * k;
    lerpColor(a.grade, b.grade, k, this.grade);

    // sun path: rises in the east (+x) at 6:00, highest at 12:00; moon on the opposite schedule
    const sa = ((H - 6) / 12) * Math.PI;
    const sunElev = Math.sin(sa) * THREE.MathUtils.degToRad(62);
    const sunDir = new THREE.Vector3(Math.cos(sa) * Math.cos(sunElev), Math.sin(sunElev), -0.45 * Math.cos(sunElev)).normalize();
    const ma = ((H - 18) / 12) * Math.PI;
    const moonElev = Math.sin(ma) * THREE.MathUtils.degToRad(48);
    const moonDir = new THREE.Vector3(Math.cos(ma) * Math.cos(moonElev) * 0.8, Math.sin(moonElev), 0.5).normalize();
    u.sunDir.value.copy(sunDir);
    u.moonDir.value.copy(moonDir);
    u.sunCol.value.copy(sunCol);
    this.night = THREE.MathUtils.clamp(1 - (sunDir.y + 0.08) / 0.2, 0, 1);
    u.night.value = this.night;
    // the shadow-casting light follows whichever body is up (keep it above the horizon)
    const lightDir = (this.night > 0.5 ? moonDir : sunDir).clone();
    lightDir.y = Math.max(0.18, lightDir.y);
    this.sunDir.copy(lightDir.normalize());
    this.sun.color.copy(sunCol);
    const lowSun = THREE.MathUtils.smoothstep(sunDir.y, -0.05, 0.12);
    this.sun.intensity = (a.sunI + (b.sunI - a.sunI) * k) * (this.night > 0.5 ? 1 : Math.max(0.35, lowSun));
    this.applyNight();
    this.follow(this.focus.x, this.focus.z);
  }

  private applyNight() {
    const n = this.night;
    for (const g of this.glowMats) g.m.emissiveIntensity = g.base * (g.day + (g.night - g.day) * n);
    for (const m of this.cloudMats) {
      m.color.copy(this.skyU.horizon.value).lerp(new THREE.Color('#ffffff'), 0.55 - n * 0.35);
      m.emissive.copy(this.skyU.horizon.value).multiplyScalar(0.45);
    }
  }

  follow(x: number, z: number) {
    this.focus.set(x, 0, z);
    this.sun.position.set(x + this.sunDir.x * 300, this.sunDir.y * 300, z + this.sunDir.z * 300);
    this.sun.target.position.set(x, 0, z);
  }

  update(dt: number, time: number) {
    this.skyU.time.value = time;
    if (this.speed) this.setHour(this.hour + dt * this.speed);
  }
}
