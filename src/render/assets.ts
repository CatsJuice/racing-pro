import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Assets {
  car: THREE.Group;
  wheel: THREE.Group;
  scenery: THREE.Group;
}

let assets: Assets | null = null;
let pending: Promise<Assets> | null = null;

export function loadAssets(onProgress?: (p: number) => void): Promise<Assets> {
  if (assets) return Promise.resolve(assets);
  if (pending) return pending;
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(import.meta.env.BASE_URL + 'draco/');
  loader.setDRACOLoader(draco);
  const base = import.meta.env.BASE_URL + 'models/';
  const files = ['car.glb', 'wheel.glb', 'scenery.glb'];
  const progress = new Array(files.length).fill(0);
  const load = (f: string, i: number) =>
    new Promise<THREE.Group>((resolve, reject) =>
      loader.load(
        base + f,
        (g) => { progress[i] = 1; onProgress?.(progress.reduce((a, b) => a + b) / files.length); resolve(g.scene); },
        (e) => { if (e.total) { progress[i] = e.loaded / e.total; onProgress?.(progress.reduce((a, b) => a + b) / files.length); } },
        reject,
      ),
    );
  pending = Promise.all(files.map(load)).then(([car, wheel, scenery]) => {
    assets = { car, wheel, scenery };
    return assets;
  });
  return pending;
}

export function getAssets(): Assets {
  if (!assets) throw new Error('assets not loaded');
  return assets;
}

/** Clone a named node from a loaded glTF scene. */
export function part(root: THREE.Object3D, name: string): THREE.Object3D {
  const o = root.getObjectByName(name);
  if (!o) throw new Error('missing model part ' + name);
  return o.clone(true);
}
