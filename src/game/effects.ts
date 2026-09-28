import * as THREE from 'three';
import { toon } from '../render/toon';

export class SkidMarks {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private max = 4000;
  private cursor = 0;
  private last: ({ x: number; z: number } | null)[] = [null, null, null, null];

  constructor() {
    this.pos = new Float32Array(this.max * 6 * 3);
    this.col = new Float32Array(this.max * 6 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    (m.userData as any).outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** intensity 0..1; 0 breaks the current mark */
  add(i: number, x: number, z: number, intensity: number, dirt = false) {
    if (intensity <= 0.02) {
      this.last[i] = null;
      return;
    }
    const prev = this.last[i];
    this.last[i] = { x, z };
    if (!prev) return;
    const dx = x - prev.x, dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 6) return;
    const w = 0.13;
    const nx = (-dz / len) * w, nz = (dx / len) * w;
    const y = 0.05;
    const quad = [
      [prev.x - nx, prev.z - nz], [prev.x + nx, prev.z + nz], [x - nx, z - nz],
      [prev.x + nx, prev.z + nz], [x + nx, z + nz], [x - nx, z - nz],
    ];
    const base = this.cursor * 6;
    const c = dirt ? [0.42, 0.3, 0.16] : [0.08, 0.08, 0.09];
    const a = Math.min(0.7, 0.2 + intensity * 0.6);
    for (let k = 0; k < 6; k++) {
      this.pos.set([quad[k][0], y, quad[k][1]], (base + k) * 3);
      this.col.set([c[0], c[1], c[2], a], (base + k) * 4);
    }
    this.cursor = (this.cursor + 1) % this.max;
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  reset() {
    this.last = [null, null, null, null];
  }
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number; size: number;
}

export class Smoke {
  mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private max = 220;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private c = new THREE.Color();

  constructor() {
    const mat = toon('#ffffff', { transparent: true, opacity: 0.85, depthWrite: false });
    (mat.userData as any).outlineParameters = { visible: false };
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  emit(x: number, z: number, vx: number, vz: number, dust: boolean) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push({
      x: x + (Math.random() - 0.5) * 0.3, y: 0.25, z: z + (Math.random() - 0.5) * 0.3,
      vx: vx * 0.25 + (Math.random() - 0.5), vy: 0.8 + Math.random() * 0.8, vz: vz * 0.25 + (Math.random() - 0.5),
      life: 0, max: dust ? 0.9 : 1.4 + Math.random() * 0.6, size: dust ? 0.8 : 1,
    });
    (this.parts[this.parts.length - 1] as any).dust = dust;
  }

  update(dt: number) {
    this.parts = this.parts.filter((p) => (p.life += dt) < p.max);
    let i = 0;
    for (const p of this.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.96; p.vz *= 0.96;
      const k = p.life / p.max;
      const s = p.size * (0.4 + 2.2 * Math.sqrt(k)) * (k > 0.7 ? (1 - k) / 0.3 : 1);
      this.m4.compose(new THREE.Vector3(p.x, p.y, p.z), this.q, new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(i, this.m4);
      this.c.set((p as any).dust ? '#b89160' : '#f2f2f2');
      this.mesh.setColorAt(i, this.c);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
