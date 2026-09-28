import * as THREE from 'three';
import { PostFX } from './post';

let gradient: THREE.DataTexture | null = null;

/** 4-band cel shading ramp. */
export function toonGradient() {
  if (!gradient) {
    const tones = [105, 150, 196, 232, 255];
    const data = new Uint8Array(tones.flatMap((t) => [t, t, t, 255]));
    gradient = new THREE.DataTexture(data, tones.length, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}


export interface Stage {
  renderer: THREE.WebGLRenderer;
  post: PostFX;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  resize(): void;
}

let stage: Stage | null = null;

export function getStage(): Stage {
  if (stage) return stage;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const post = new PostFX(renderer);
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    post.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();
  const render = (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    post.render(scene, camera);
  };
  stage = { renderer, post, render, resize };
  return stage;
}

/** Gradient sky dome + fog + sun/hemisphere lights. */
export function createEnvironment(scene: THREE.Scene, opts: { shadowSize?: number } = {}) {
  const top = new THREE.Color('#4aa3ff');
  const horizon = new THREE.Color('#d8f0ff');
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2400, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: top }, horizon: { value: horizon } },
      vertexShader: `varying vec3 vP; void main(){ vP = (modelMatrix*vec4(position,1.)).xyz - cameraPosition; gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.);} `,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = normalize(vP).y; float k = smoothstep(-0.02, 0.45, h); gl_FragColor = vec4(mix(horizon, top, k), 1.); }`,
    }),
  );
  sky.userData.noOutline = true;
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(horizon.clone(), 420, 2600);

  const hemi = new THREE.HemisphereLight('#dff1ff', '#6b8f4e', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
  sun.position.set(-120, 200, -80);
  sun.castShadow = true;
  const S = opts.shadowSize ?? 60;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  // visible sun disc (blooms) in the light's direction
  const disc = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.6, 2.8), fog: false, depthWrite: false }));
  disc.userData.noOutline = true;
  disc.renderOrder = -0.5;
  const sunDir = new THREE.Vector3(-120, 200, -80).normalize();
  disc.onBeforeRender = (_r, _s, cam) => {
    disc.position.copy(cam.position).addScaledVector(sunDir, 2200);
    disc.lookAt(cam.position);
  };
  disc.frustumCulled = false;
  scene.add(disc);
  return { sky, sun, hemi };
}

/** Keeps the directional light's shadow frustum centred on a focus point. */
export function followSun(sun: THREE.DirectionalLight, x: number, z: number) {
  sun.position.set(x - 120, 200, z - 80);
  sun.target.position.set(x, 0, z);
}

const SPECIAL_EMISSIVE = /Light$/;

/**
 * Converts glTF PBR materials to cel-shaded toon materials. Materials named
 * "Paint"/"Stripe" get the provided colours.
 */
export function toonify(root: THREE.Object3D, colors: Record<string, string> = {}, cache = new Map<string, THREE.Material>()) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const conv = (m: THREE.Material): THREE.Material => {
      const key = m.name;
      const hit = cache.get(key);
      if (hit) return hit;
      const src = m as THREE.MeshStandardMaterial;
      const color = colors[key] ? new THREE.Color(colors[key]) : src.color?.clone() ?? new THREE.Color('#fff');
      const params: THREE.MeshToonMaterialParameters = { color, gradientMap: toonGradient(), name: key };
      if (SPECIAL_EMISSIVE.test(key) || (src.emissiveIntensity > 0 && src.emissive && src.emissive.getHex() !== 0)) {
        params.emissive = color.clone();
        params.emissiveIntensity = key === 'TailLight' ? 0.6 : key === 'DrlLight' ? 2.4 : key === 'IndicatorLight' ? 0.9 : 1.5;
      }
      if (key === 'LensGlass') {
        params.transparent = true;
        params.opacity = 0.28;
        params.depthWrite = false;
        params.emissive = new THREE.Color('#ffffff');
        params.emissiveIntensity = 0.15;
      }
      if (key === 'Glass') {
        params.color = new THREE.Color('#223a5c');
        params.emissive = new THREE.Color('#0d1a2e');
      }
      if (key === 'Cloud' || key === 'Snow') params.emissive = new THREE.Color('#a9bccf');
      if (key === 'Chrome' || key === 'Rim' || key === 'Disc' || key === 'Steel') {
        params.emissive = color.clone().multiplyScalar(0.18);
      }
      const t = new THREE.MeshToonMaterial(params);
      cache.set(key, t);
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
  return cache;
}
