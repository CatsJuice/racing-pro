import * as THREE from 'three';
import type { Environment } from './environment';
import { PostFX } from './post';
import { isTouch } from '../ui/device';

let gradient: THREE.DataTexture | null = null;

/**
 * Soft cel ramp: a dark plateau, a smooth (linear-filtered) terminator and a bright
 * plateau. Shadowed sides fall back to the tinted hemisphere light, which gives the
 * purple/blue shadows of the art direction.
 */
export function toonGradient() {
  if (!gradient) {
    const tones = [70, 88, 120, 175, 225, 248, 255, 255];
    const data = new Uint8Array(tones.flatMap((t) => [t, t, t, 255]));
    gradient = new THREE.DataTexture(data, tones.length, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.LinearFilter;
    gradient.magFilter = THREE.LinearFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

/** shared wind clock for foliage / grass sway */
export const wind = { value: 0 };

function addWind(m: THREE.Material, amount: number, pow: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float hgt = max(position.y, 0.0);
      float w = sin(uWind * 1.6 + ip.x * 0.21 + ip.z * 0.17 + position.x * 0.8) + 0.4 * sin(uWind * 3.1 + ip.z * 0.5 + position.z);
      transformed.xz += vec2(w, w * 0.6) * ${amount.toFixed(3)} * pow(hgt, ${pow.toFixed(2)});`,
    );
  };
  m.customProgramCacheKey = () => `wind${amount}${pow}`;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  post: PostFX;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, env?: Environment): void;
  resize(): void;
}

let stage: Stage | null = null;

export function getStage(): Stage {
  if (stage) return stage;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // phones have tiny pixels and a weaker GPU; the ink/bloom passes run at full resolution
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.3 : 1.75));
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
  const start = performance.now();
  const render = (scene: THREE.Scene, camera: THREE.PerspectiveCamera, env?: Environment) => {
    wind.value = (performance.now() - start) / 1000;
    camera.aspect = window.innerWidth / window.innerHeight;
    // portrait screens: widen the vertical fov so the horizontal view doesn't collapse
    const fov = camera.fov;
    if (camera.aspect < 1) {
      const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) / Math.pow(camera.aspect, 0.7));
      camera.fov = THREE.MathUtils.radToDeg(half * 2);
    }
    camera.updateProjectionMatrix();
    post.render(scene, camera, env);
    camera.fov = fov;
  };
  stage = { renderer, post, render, resize };
  return stage;
}

const SPECIAL_EMISSIVE = /Light$/;

/**
 * Converts glTF PBR materials to soft cel-shaded materials. Materials named
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
      const params: THREE.MeshToonMaterialParameters = { color, gradientMap: toonGradient(), name: key, vertexColors: src.vertexColors };
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
        params.color = new THREE.Color('#2b3566');
        params.emissive = new THREE.Color('#1a1638');
      }
      if (key === 'Cloud' || key === 'Snow') params.emissive = new THREE.Color('#a9bccf');
      if (key === 'Chrome' || key === 'Rim' || key === 'Disc' || key === 'Steel') params.emissive = color.clone().multiplyScalar(0.18);
      const leaf = key.startsWith('Leaf_');
      const grass = key === 'GrassClump';
      if (leaf || grass) params.side = THREE.DoubleSide;
      if (leaf) params.emissive = color.clone().multiplyScalar(0.12); // light bleeding through leaves
      const t = new THREE.MeshToonMaterial(params);
      if (leaf) addWind(t, 0.03, 1.0);
      if (grass) addWind(t, 0.12, 1.6);
      cache.set(key, t);
      return t;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
  return cache;
}
