import * as THREE from 'three';
import { hashString, rng } from '../core/rng';
import type { Surface } from '../car/physics';
import { getAssets, part } from '../render/assets';
import { toon, toonify, toonGradient } from '../render/toon';
import { TrackGeometry, type TrackData, type TrackProjection } from './track';

const KERB_W = 1.4;
const GRAVEL_W = 13;

export const SURFACES: Record<string, Surface> = {
  asphalt: { grip: 1, rolling: 0, kind: 'asphalt' },
  kerb: { grip: 0.94, rolling: 0.01, kind: 'kerb' },
  grass: { grip: 0.62, rolling: 0.05, kind: 'grass' },
  gravel: { grip: 0.5, rolling: 0.22, kind: 'grass' },
};

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(c: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size = 2) {
  const r = rng(99);
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(r.next() * colors.length)];
    c.fillRect(r.next() * w, r.next() * h, size, size);
  }
}

let texCache: Record<string, THREE.Texture> | null = null;
function textures() {
  if (texCache) return texCache;
  texCache = {
    road: canvasTexture(256, 256, (c) => {
      c.fillStyle = '#5b5f68';
      c.fillRect(0, 0, 256, 256);
      speckle(c, 256, 256, 2600, ['#52565e', '#666a73', '#4d5058', '#6f737c']);
      c.fillStyle = '#f5f5f0';
      c.fillRect(6, 0, 7, 256);
      c.fillRect(243, 0, 7, 256);
    }),
    kerb: canvasTexture(64, 128, (c) => {
      c.fillStyle = '#e63946';
      c.fillRect(0, 0, 64, 64);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 64, 64, 64);
    }),
    gravel: canvasTexture(128, 128, (c) => {
      c.fillStyle = '#e3c98f';
      c.fillRect(0, 0, 128, 128);
      speckle(c, 128, 128, 1400, ['#cdb173', '#f0dcae', '#bfa066', '#d9bd84'], 2);
    }),
    grass: canvasTexture(256, 256, (c) => {
      c.fillStyle = '#7cc653';
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#86d15c';
      c.fillRect(0, 0, 256, 128);
      speckle(c, 256, 256, 900, ['#72bb4a', '#8fd765', '#6bb244'], 3);
    }),
    barrier: canvasTexture(128, 32, (c) => {
      for (let i = 0; i < 4; i++) {
        c.fillStyle = i % 2 ? '#ffffff' : '#e63946';
        c.fillRect(i * 32, 0, 32, 32);
      }
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(0, 26, 128, 6);
    }),
    checker: canvasTexture(128, 32, (c) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        c.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        c.fillRect(i * 8, j * 8, 8, 8);
      }
    }),
  };
  return texCache;
}

/** Inverted hull outline (works with instancing, unlike OutlineEffect). */
function hullMaterial(thickness: number) {
  const m = new THREE.MeshBasicMaterial({ color: 0x1b1d2a, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(3)};`);
  };
  (m.userData as any).outlineParameters = { visible: false };
  return m;
}

interface Placement {
  x: number;
  z: number;
  rot: number;
  scale: number;
  y?: number;
}

export class TrackScene {
  group = new THREE.Group();
  geo: TrackGeometry;
  kerb: Uint8Array;
  gravel: Int8Array; // +1 gravel on the left, -1 on the right
  barrierL: Uint8Array;
  barrierR: Uint8Array;
  barrierOffset: number;
  private floaters: { obj: THREE.Object3D; speed: number; phase: number; base: THREE.Vector3 }[] = [];
  private sceneryCache = new Map<string, THREE.Material>();

  constructor(readonly data: TrackData, opts: { scenery?: boolean } = {}) {
    const g = (this.geo = new TrackGeometry(data));
    const N = g.count;
    const hw = g.width / 2;
    this.barrierOffset = hw + KERB_W + GRAVEL_W + 2;

    // ---------------------------------------------------------------- masks
    const kerbRaw = new Uint8Array(N);
    const gravRaw = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      const c = Math.abs(g.samples[i].curv);
      if (c > 1 / 110) kerbRaw[i] = 1;
      if (c > 1 / 75) gravRaw[i] = g.samples[i].curv > 0 ? -1 : 1;
    }
    this.kerb = dilate(kerbRaw, 10);
    this.gravel = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      if (!gravRaw[i]) continue;
      for (let k = -30; k <= 20; k++) this.gravel[(i + k + N) % N] = gravRaw[i];
    }
    this.barrierL = new Uint8Array(N);
    this.barrierR = new Uint8Array(N);
    this.computeBarriers();

    this.buildGround();
    this.buildRoad();
    this.buildStartLine();
    this.buildBarriers();
    this.buildBoards();
    if (opts.scenery !== false) this.buildScenery();
  }

  // ------------------------------------------------------------------ queries
  surfaceAt(x: number, z: number, hint: number): { surface: Surface; proj: TrackProjection } {
    const proj = this.geo.project(x, z, hint);
    const hw = this.geo.width / 2;
    const a = Math.abs(proj.lateral);
    let surface = SURFACES.asphalt;
    if (a > hw) {
      if (a < hw + KERB_W && this.kerb[proj.index]) surface = SURFACES.kerb;
      else {
        const side = proj.lateral > 0 ? 1 : -1;
        if (this.gravel[proj.index] === side && a < hw + KERB_W + GRAVEL_W) surface = SURFACES.gravel;
        else surface = SURFACES.grass;
      }
    }
    return { surface, proj };
  }

  hasBarrier(index: number, side: number) {
    return side > 0 ? !!this.barrierL[index] : !!this.barrierR[index];
  }

  private computeBarriers() {
    const g = this.geo;
    const N = g.count;
    const off = this.barrierOffset;
    const clearance = g.width / 2 + 5;
    for (let i = 0; i < N; i++) {
      const c = g.samples[i];
      for (const side of [1, -1]) {
        const px = c.x + c.nx * off * side, pz = c.z + c.nz * off * side;
        let ok = true;
        for (let j = 0; j < N; j += 2) {
          const d = Math.abs(g.samples[j].s - c.s);
          if (Math.min(d, g.length - d) < off * 1.5) continue;
          const q = g.samples[j];
          if ((q.x - px) ** 2 + (q.z - pz) ** 2 < clearance * clearance) { ok = false; break; }
        }
        (side > 0 ? this.barrierL : this.barrierR)[i] = ok ? 1 : 0;
      }
    }
    // remove tiny isolated gaps / segments
    for (const arr of [this.barrierL, this.barrierR]) {
      const e = erode(dilate(arr, 3), 3);
      arr.set(e);
    }
  }

  // ------------------------------------------------------------------ builders
  private ribbon(o1: number, o2: number, y: number, mask: (i: number) => boolean, vScale: number, flip = false) {
    const g = this.geo;
    const N = g.count;
    const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!mask(i) || !mask((i + 1) % N)) continue;
      const a = g.samples[i], b = g.samples[(i + 1) % N];
      const sb = i + 1 === N ? g.length : b.s;
      const p = (c: typeof a, o: number) => [c.x + c.nx * o, y, c.z + c.nz * o];
      const A1 = p(a, o1), A2 = p(a, o2), B1 = p(b, o1), B2 = p(b, o2);
      const va = a.s / vScale, vb = sb / vScale;
      const quad = flip ? [A1, B1, A2, A2, B1, B2] : [A1, A2, B1, A2, B2, B1];
      const uvs = flip ? [[0, va], [0, vb], [1, va], [1, va], [0, vb], [1, vb]] : [[0, va], [1, va], [0, vb], [1, va], [1, vb], [0, vb]];
      quad.forEach((v) => pos.push(...v));
      uvs.forEach((v) => uv.push(...v));
      for (let k = 0; k < 6; k++) nrm.push(0, 1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    return geo;
  }

  private buildGround() {
    const b = this.geo.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 1600;
    const tex = textures().grass.clone();
    tex.needsUpdate = true;
    tex.repeat.set(size / 24, size / 24);
    const m = toon('#ffffff', { map: tex });
    (m.userData as any).outlineParameters = { visible: false };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private flatMat(tex: THREE.Texture, polygonOffset = -1) {
    const m = toon('#ffffff', { map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: polygonOffset, polygonOffsetUnits: polygonOffset });
    (m.userData as any).outlineParameters = { visible: false };
    return m;
  }

  private buildRoad() {
    const g = this.geo;
    const hw = g.width / 2;
    const T = textures();
    // make the road texture scale with track width: 1 texture tile across the road, 1:1 aspect
    const road = new THREE.Mesh(this.ribbon(-hw, hw, 0.02, () => true, g.width, true), this.flatMat(T.road, -2));
    road.receiveShadow = true;
    this.group.add(road);
    for (const side of [1, -1]) {
      const kerb = new THREE.Mesh(
        this.ribbon(side * hw, side * (hw + KERB_W), 0.04, (i) => !!this.kerb[i], 4, side < 0),
        this.flatMat(T.kerb, -3),
      );
      kerb.receiveShadow = true;
      this.group.add(kerb);
      const gv = new THREE.Mesh(
        this.ribbon(side * (hw + KERB_W), side * (hw + KERB_W + GRAVEL_W), 0.012, (i) => this.gravel[i] === side, 6, side < 0),
        this.flatMat(T.gravel, -1),
      );
      gv.receiveShadow = true;
      this.group.add(gv);
    }
  }

  private buildStartLine() {
    const g = this.geo;
    const c = g.samples[0];
    const heading = Math.atan2(c.tx, c.tz);
    const tex = textures().checker;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(g.width, 2), this.flatMat(tex, -4));
    line.rotation.set(-Math.PI / 2, heading, 0, 'YXZ');
    line.position.set(c.x, 0.045, c.z);
    this.group.add(line);
    // grid slots
    const white = toon('#f5f5f0', { side: THREE.DoubleSide });
    (white.userData as any).outlineParameters = { visible: false };
    for (let k = 0; k < 6; k++) {
      const p = g.pointAt(-12 - k * 9);
      const side = k % 2 ? -1 : 1;
      const h = Math.atan2(p.tx, p.tz);
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.35), white);
      slot.rotation.set(-Math.PI / 2, h, 0, 'YXZ');
      slot.position.set(p.x + p.nx * side * g.width * 0.22, 0.045, p.z + p.nz * side * g.width * 0.22);
      this.group.add(slot);
    }
    try {
      const gantry = part(getAssets().scenery, 'gantry');
      toonify(gantry, {}, this.sceneryCache);
      gantry.position.set(c.x, 0, c.z);
      gantry.rotation.y = heading;
      gantry.scale.set((g.width / 2 + 3) / 8.4, 1, 1);
      this.group.add(gantry);
    } catch (e) {
      console.warn(e);
    }
  }

  private buildBarriers() {
    const g = this.geo;
    const N = g.count;
    const off = this.barrierOffset;
    const T = textures();
    for (const side of [1, -1]) {
      const arr = side > 0 ? this.barrierL : this.barrierR;
      const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (!arr[i] || !arr[j]) continue;
        const a = g.samples[i], b = g.samples[j];
        const sb = j === 0 ? g.length : b.s;
        const ax = a.x + a.nx * off * side, az = a.z + a.nz * off * side;
        const bx = b.x + b.nx * off * side, bz = b.z + b.nz * off * side;
        const H = 1.0;
        const va = a.s / 4, vb = sb / 4;
        // face toward the track
        const nx = -a.nx * side, nz = -a.nz * side;
        const quad = [[ax, 0, az, va, 0], [bx, 0, bz, vb, 0], [ax, H, az, va, 1], [ax, H, az, va, 1], [bx, 0, bz, vb, 0], [bx, H, bz, vb, 1]];
        if (side < 0) { const t = quad[1]; quad[1] = quad[2]; quad[2] = t; const t2 = quad[4]; quad[4] = quad[5]; quad[5] = t2; }
        for (const q of quad) { pos.push(q[0], q[1], q[2]); uv.push(q[3], q[4]); nrm.push(nx, 0, nz); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      const m = toon('#ffffff', { map: T.barrier, side: THREE.DoubleSide });
      (m.userData as any).outlineParameters = { visible: false };
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** 100 / 50 m braking boards before corners that follow a straight. */
  private buildBoards() {
    const g = this.geo;
    const N = g.count;
    const boardTex = (label: string) =>
      canvasTexture(128, 96, (c) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 128, 96);
        c.strokeStyle = '#e63946';
        c.lineWidth = 10;
        c.strokeRect(5, 5, 118, 86);
        c.fillStyle = '#1b1d2a';
        c.font = 'bold 54px "Baloo 2", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, 64, 52);
      }, false);
    const tex = { 100: boardTex('100'), 50: boardTex('50') } as Record<number, THREE.Texture>;
    const post = toon('#e6e6e6');
    let lastEntry = -1e9;
    for (let i = 0; i < N; i++) {
      const c = Math.abs(g.samples[i].curv);
      if (c < 1 / 70) continue;
      // find corner entry: walk back until curvature is small
      let e = i;
      while (Math.abs(g.at(e).curv) > 1 / 180 && i - e < 200) e--;
      // straight long enough before?
      let straight = true;
      for (let k = 1; k < 130; k++) if (Math.abs(g.at(e - k).curv) > 1 / 180) { straight = false; break; }
      const sEntry = g.at(e).s;
      if (!straight || Math.abs(sEntry - lastEntry) < 150) continue;
      lastEntry = sEntry;
      const side = g.samples[i].curv > 0 ? -1 : 1; // outside of the corner
      for (const d of [100, 50]) {
        const p = g.pointAt(sEntry - d);
        const off = (g.width / 2 + 3) * side;
        const grp = new THREE.Group();
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), toon('#ffffff', { map: tex[d], side: THREE.DoubleSide }));
        board.position.y = 1.4;
        grp.add(board);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), post);
        pole.position.y = 0.5;
        grp.add(pole);
        grp.position.set(p.x + p.nx * off, 0, p.z + p.nz * off);
        grp.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI;
        grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        this.group.add(grp);
      }
      i += 60;
    }
  }

  private instanced(name: string, list: Placement[], outline = 0.05) {
    if (!list.length) return;
    const template = part(getAssets().scenery, name);
    template.position.set(0, 0, 0);
    template.rotation.set(0, 0, 0);
    template.scale.set(1, 1, 1);
    toonify(template, {}, this.sceneryCache);
    template.updateMatrixWorld(true);
    const tmp = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const mats = list.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q.setFromAxisAngle(up, p.rot).clone(), new THREE.Vector3(p.scale, p.scale, p.scale)));
    const hull = hullMaterial(outline);
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshToonMaterial;
      const mat = src.clone();
      (mat.userData as any).outlineParameters = { visible: false };
      const im = new THREE.InstancedMesh(mesh.geometry, mat, list.length);
      const ih = new THREE.InstancedMesh(mesh.geometry, hull, list.length);
      for (let i = 0; i < list.length; i++) {
        tmp.multiplyMatrices(mats[i], mesh.matrixWorld);
        im.setMatrixAt(i, tmp);
        ih.setMatrixAt(i, tmp);
      }
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      ih.computeBoundingSphere();
      this.group.add(im, ih);
    });
  }

  private single(name: string, x: number, z: number, rot: number, scale = 1, y = 0) {
    const o = part(getAssets().scenery, name);
    toonify(o, {}, this.sceneryCache);
    o.position.set(x, y, z);
    o.rotation.y = rot;
    o.scale.setScalar(scale);
    this.group.add(o);
    return o;
  }

  private buildScenery() {
    const g = this.geo;
    const R = rng(hashString(this.data.id + this.data.points.length));
    const b = g.bounds;
    const hw = g.width / 2;
    const occupied: { x: number; z: number; r: number }[] = [];
    const free = (x: number, z: number, r: number, trackGap: number) => {
      if (g.distanceTo(x, z, 2) < hw + trackGap + r) return false;
      return occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
    };
    const faceTrack = (px: number, pz: number, nx: number, nz: number) => {
      void px; void pz;
      return Math.atan2(nx, nz);
    };

    // grandstand + pits along the start straight
    const standPlaced: number[] = [];
    for (const [name, off, sOff, r] of [['grandstand', 24, 40, 14], ['pit_building', 26, 40, 16]] as [string, number, number, number][]) {
      for (const side of [1, -1]) {
        if (standPlaced.includes(side)) continue;
        const p = g.pointAt(sOff);
        const d = hw + off;
        const x = p.x + p.nx * d * side, z = p.z + p.nz * d * side;
        if (!free(x, z, r, 10)) continue;
        this.single(name, x, z, faceTrack(x, z, -p.nx * side, -p.nz * side));
        occupied.push({ x, z, r });
        standPlaced.push(side);
        if (name === 'pit_building') {
          for (let k = 0; k < 3; k++) {
            const q = g.pointAt(sOff + 22 + k * 8);
            const tx = q.x + q.nx * (d + 2) * side, tz = q.z + q.nz * (d + 2) * side;
            if (free(tx, tz, 3, 8)) { this.single('tent', tx, tz, R.range(0, 6)); occupied.push({ x: tx, z: tz, r: 3 }); }
          }
        }
        break;
      }
    }

    // billboards along the track
    for (let s = 120; s < g.length - 60; s += R.range(140, 240)) {
      const p = g.pointAt(s);
      const side = R.next() > 0.5 ? 1 : -1;
      const d = this.barrierOffset + 6;
      const x = p.x + p.nx * d * side, z = p.z + p.nz * d * side;
      if (!free(x, z, 5, this.barrierOffset - hw + 3)) continue;
      this.single('billboard', x, z, faceTrack(x, z, -p.nx * side, -p.nz * side));
      occupied.push({ x, z, r: 5 });
    }

    // tire stacks lining the gravel traps
    const tires: Placement[] = [];
    const cones: Placement[] = [];
    for (let i = 0; i < g.count; i += 4) {
      const side = this.gravel[i];
      if (!side || !(side > 0 ? this.barrierL[i] : this.barrierR[i])) continue;
      const c = g.samples[i];
      const d = (this.barrierOffset - 0.8) * side;
      tires.push({ x: c.x + c.nx * d, z: c.z + c.nz * d, rot: R.range(0, 6), scale: 1 });
    }
    // apex cones
    for (let i = 0; i < g.count; i++) {
      const c = g.samples[i];
      if (Math.abs(c.curv) < 1 / 60) continue;
      const prev = Math.abs(g.at(i - 1).curv), next = Math.abs(g.at(i + 1).curv);
      if (Math.abs(c.curv) >= prev && Math.abs(c.curv) >= next) {
        const side = c.curv > 0 ? 1 : -1; // inside
        const d = (hw + KERB_W + 1.2) * side;
        cones.push({ x: c.x + c.nx * d, z: c.z + c.nz * d, rot: 0, scale: 1.2 });
      }
    }
    this.instanced('tire_stack', tires, 0.04);
    this.instanced('cone', cones, 0.03);

    // vegetation
    const lists: Record<string, Placement[]> = { tree_pine: [], tree_round: [], bush: [], rock: [] };
    const margin = 260;
    let tries = 0;
    const target = Math.min(900, Math.round(((b.maxX - b.minX + 2 * margin) * (b.maxZ - b.minZ + 2 * margin)) / 900));
    let placed = 0;
    while (placed < target && tries < target * 6) {
      tries++;
      const x = R.range(b.minX - margin, b.maxX + margin);
      const z = R.range(b.minZ - margin, b.maxZ + margin);
      const roll = R.next();
      const kind = roll < 0.4 ? 'tree_pine' : roll < 0.72 ? 'tree_round' : roll < 0.9 ? 'bush' : 'rock';
      const r = kind === 'bush' || kind === 'rock' ? 2 : 3;
      if (!free(x, z, r, this.barrierOffset - hw + 4)) continue;
      // cluster: trees prefer to be near other trees
      lists[kind].push({ x, z, rot: R.range(0, Math.PI * 2), scale: R.range(0.8, 1.5) });
      occupied.push({ x, z, r: r * 0.6 });
      placed++;
    }
    for (const k of Object.keys(lists)) this.instanced(k, lists[k], k === 'rock' ? 0.05 : 0.07);

    // sky decorations
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 500;
    for (let i = 0; i < 26; i++) {
      const o = this.single('cloud', cx + R.range(-span, span), cz + R.range(-span, span), R.range(0, 6), R.range(2.5, 5), R.range(110, 190));
      o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { (m as THREE.Mesh).castShadow = false; } });
      this.floaters.push({ obj: o, speed: R.range(0.6, 1.6), phase: 0, base: o.position.clone() });
    }
    for (let i = 0; i < 3; i++) {
      const o = this.single('balloon', cx + R.range(-span * 0.5, span * 0.5), cz + R.range(-span * 0.5, span * 0.5), R.range(0, 6), 1.6, R.range(50, 90));
      this.floaters.push({ obj: o, speed: R.range(0.5, 1), phase: R.range(0, 6), base: o.position.clone() });
    }
  }

  setSkyVisible(v: boolean) {
    for (const f of this.floaters) f.obj.visible = v;
  }

  /** Animated decorations (clouds drifting, balloons bobbing). */
  update(t: number) {
    for (const f of this.floaters) {
      f.obj.position.x = f.base.x + Math.sin(t * 0.01 * f.speed + f.phase) * 60;
      f.obj.position.y = f.base.y + Math.sin(t * 0.4 * f.speed + f.phase) * 1.5;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as any).isInstancedMesh) m.geometry?.dispose();
    });
  }
}

function dilate(src: Uint8Array | Int8Array, r: number) {
  const N = src.length;
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!src[i]) continue;
    for (let k = -r; k <= r; k++) out[(i + k + N) % N] = 1;
  }
  return out;
}

function erode(src: Uint8Array, r: number) {
  const N = src.length;
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let ok = 1;
    for (let k = -r; k <= r; k++) if (!src[(i + k + N) % N]) { ok = 0; break; }
    out[i] = ok;
  }
  return out;
}

export { toonGradient };
