import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashString, rng } from '../core/rng';
import type { Surface } from '../car/physics';
import { getAssets, part } from '../render/assets';
import { toon, toonify } from '../render/toon';
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

function speckle(c: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size = 2, seed = 99) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(r.next() * colors.length)];
    const s = size * (0.6 + r.next() * 0.8);
    c.fillRect(r.next() * w, r.next() * h, s, s);
  }
}

/** soft round blotches that wrap around the tile edges */
function blotches(c: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], rMin: number, rMax: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r.next() * w, y = r.next() * h, rad = rMin + r.next() * (rMax - rMin);
    const col = colors[Math.floor(r.next() * colors.length)];
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
}

let texCache: Record<string, THREE.Texture> | null = null;
function textures() {
  if (texCache) return texCache;
  texCache = {
    road: canvasTexture(512, 512, (c) => {
      c.fillStyle = '#857a8e';
      c.fillRect(0, 0, 512, 512);
      blotches(c, 512, 512, 26, ['rgba(80,64,96,0.35)', 'rgba(140,118,140,0.25)'], 30, 90, 3);
      speckle(c, 512, 512, 9000, ['#7a6f84', '#90849a', '#70667a', '#9c90a6', '#887c92'], 2.2, 5);
      // rubbered-in racing line, slightly darker in the middle third
      const g = c.createLinearGradient(0, 0, 512, 0);
      g.addColorStop(0.28, 'rgba(30,32,38,0)');
      g.addColorStop(0.5, 'rgba(40,28,52,0.2)');
      g.addColorStop(0.72, 'rgba(30,32,38,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 512, 512);
      // hairline cracks
      c.strokeStyle = 'rgba(40,42,48,0.35)';
      c.lineWidth = 1.2;
      const r = rng(8);
      for (let i = 0; i < 7; i++) {
        let x = r.next() * 512, y = r.next() * 512;
        c.beginPath();
        c.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (r.next() - 0.5) * 40; y += r.next() * 30; c.lineTo(x, y); }
        c.stroke();
      }
      c.fillStyle = '#f7f7f2';
      c.fillRect(10, 0, 12, 512);
      c.fillRect(490, 0, 12, 512);
    }),
    kerb: canvasTexture(64, 128, (c) => {
      c.fillStyle = '#e63946';
      c.fillRect(0, 0, 64, 64);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 64, 64, 64);
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(0, 60, 64, 4);
      c.fillRect(0, 124, 64, 4);
    }),
    gravel: canvasTexture(256, 256, (c) => {
      c.fillStyle = '#f0a15a';
      c.fillRect(0, 0, 256, 256);
      blotches(c, 256, 256, 14, ['rgba(220,120,70,0.45)', 'rgba(255,200,130,0.4)'], 20, 60, 12);
      speckle(c, 256, 256, 5000, ['#e08a4a', '#ffc080', '#d4783c', '#f5ab66', '#c56a3a'], 2.4, 13);
    }),
    grass: canvasTexture(512, 512, (c) => {
      c.fillStyle = '#9db43f';
      c.fillRect(0, 0, 512, 512);
      blotches(c, 512, 512, 34, ['rgba(120,160,50,0.5)', 'rgba(210,190,70,0.45)', 'rgba(150,175,55,0.45)', 'rgba(235,150,70,0.3)'], 40, 140, 21);
      speckle(c, 512, 512, 5000, ['#8aa53a', '#b8c24a', '#7b9a34', '#d2b848', '#e0904a'], 3, 22);
    }),
    checker: canvasTexture(128, 32, (c) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        c.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        c.fillRect(i * 8, j * 8, 8, 8);
      }
    }),
    tireWall: canvasTexture(128, 32, (c) => {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = i % 2 ? '#26272c' : '#1c1d21';
        c.beginPath();
        c.arc(i * 16 + 8, 16, 9, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#e63946';
      c.fillRect(0, 0, 128, 7);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 25, 128, 7);
    }),
  };
  return texCache;
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
  private occupied: { x: number; z: number; r: number }[] = [];

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
    for (const arr of [this.barrierL, this.barrierR]) arr.set(erode(dilate(arr, 3), 3));
  }

  /** point on an offset line (left normal * lateral) */
  private at(i: number, lateral: number) {
    const c = this.geo.at(i);
    return { x: c.x + c.nx * lateral, z: c.z + c.nz * lateral, c };
  }

  // ------------------------------------------------------------------ builders
  /** strip between two lateral offsets; `profile` optionally raises the middle (for kerbs) */
  private ribbon(o1: number, o2: number, y: number, mask: (i: number) => boolean, vScale: number, profile?: number[]) {
    const g = this.geo;
    const N = g.count;
    const cols = profile ? profile.length : 2;
    const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
    const vert = (c: typeof g.samples[0], k: number, s: number) => {
      const t = k / (cols - 1);
      const o = o1 + (o2 - o1) * t;
      pos.push(c.x + c.nx * o, y + (profile ? profile[k] : 0), c.z + c.nz * o);
      uv.push(t, s / vScale);
      nrm.push(0, 1, 0);
    };
    for (let i = 0; i < N; i++) {
      if (!mask(i) || !mask((i + 1) % N)) continue;
      const a = g.samples[i], b = g.samples[(i + 1) % N];
      const sb = i + 1 === N ? g.length : b.s;
      for (let k = 0; k < cols - 1; k++) {
        vert(a, k, a.s); vert(a, k + 1, a.s); vert(b, k, sb);
        vert(a, k + 1, a.s); vert(b, k + 1, sb); vert(b, k, sb);
      }
    }
    // make every triangle face up (the offsets can be in either order)
    for (let t = 0; t < pos.length; t += 9) {
      const ax = pos[t + 3] - pos[t], az = pos[t + 5] - pos[t + 2];
      const bx = pos[t + 6] - pos[t], bz = pos[t + 8] - pos[t + 2];
      if (az * bx - ax * bz < 0) {
        for (let k = 0; k < 3; k++) [pos[t + 3 + k], pos[t + 6 + k]] = [pos[t + 6 + k], pos[t + 3 + k]];
        const u = (t / 9) * 6;
        for (let k = 0; k < 2; k++) [uv[u + 2 + k], uv[u + 4 + k]] = [uv[u + 4 + k], uv[u + 2 + k]];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    if (profile) geo.computeVertexNormals();
    return geo;
  }

  private flatMat(tex: THREE.Texture, polygonOffset = -1) {
    return toon('#ffffff', { map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: polygonOffset, polygonOffsetUnits: polygonOffset });
  }

  private buildGround() {
    const b = this.geo.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 3200;
    const tex = textures().grass.clone();
    tex.needsUpdate = true;
    tex.repeat.set(size / 40, size / 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), toon('#ffffff', { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    ground.userData.noOutline = true;
    this.group.add(ground);
  }

  private buildRoad() {
    const g = this.geo;
    const hw = g.width / 2;
    const T = textures();
    const road = new THREE.Mesh(this.ribbon(-hw, hw, 0.02, () => true, g.width), this.flatMat(T.road, -2));
    road.receiveShadow = true;
    road.userData.noOutline = true;
    this.group.add(road);
    for (const side of [1, -1]) {
      // raised, rounded kerb profile
      const kerb = new THREE.Mesh(
        this.ribbon(side * (hw - 0.05), side * (hw + KERB_W), 0.02, (i) => !!this.kerb[i], 4, [0, 0.05, 0.075, 0.07, 0.04, 0]),
        toon('#ffffff', { map: T.kerb, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      );
      kerb.receiveShadow = true;
      kerb.castShadow = true;
      kerb.userData.noOutline = true;
      this.group.add(kerb);
      const gv = new THREE.Mesh(
        this.ribbon(side * (hw + KERB_W), side * (hw + KERB_W + GRAVEL_W), 0.012, (i) => this.gravel[i] === side, 8),
        this.flatMat(T.gravel, -1),
      );
      gv.receiveShadow = true;
      gv.userData.noOutline = true;
      this.group.add(gv);
    }
  }

  private buildStartLine() {
    const g = this.geo;
    const c = g.samples[0];
    const heading = Math.atan2(c.tx, c.tz);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(g.width, 2), this.flatMat(textures().checker, -4));
    line.rotation.set(-Math.PI / 2, heading, 0, 'YXZ');
    line.position.set(c.x, 0.045, c.z);
    line.userData.noOutline = true;
    this.group.add(line);
    const white = toon('#f5f5f0', { side: THREE.DoubleSide });
    for (let k = 0; k < 8; k++) {
      const p = g.pointAt(-12 - k * 9);
      const side = k % 2 ? -1 : 1;
      const h = Math.atan2(p.tx, p.tz);
      // grid box: three sides of a rectangle
      for (const [w, d, ox, oz] of [[2.6, 0.3, 0, 0], [0.3, 4.5, -1.15, -2.1], [0.3, 4.5, 1.15, -2.1]] as number[][]) {
        const slot = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white);
        slot.rotation.set(-Math.PI / 2, h, 0, 'YXZ');
        const lx = p.x + p.nx * side * g.width * 0.22, lz = p.z + p.nz * side * g.width * 0.22;
        slot.position.set(lx + p.nx * ox + p.tx * oz, 0.045, lz + p.nz * ox + p.tz * oz);
        slot.userData.noOutline = true;
        this.group.add(slot);
      }
    }
    const gantry = part(getAssets().scenery, 'gantry');
    toonify(gantry, {}, this.sceneryCache);
    gantry.position.set(c.x, 0, c.z);
    gantry.rotation.y = heading;
    gantry.scale.set((g.width / 2 + 3) / 8.45, 1, 1);
    this.group.add(gantry);
    this.occupied.push({ x: c.x, z: c.z, r: g.width / 2 + 6 });
  }

  /** Armco (double steel rail on posts) everywhere, tyre walls where there is a gravel trap. */
  private buildBarriers() {
    const g = this.geo;
    const N = g.count;
    const off = this.barrierOffset;
    const steel = toon('#b4bcc6', { emissive: new THREE.Color('#1c2028') });
    const posts: Placement[] = [];
    const tireWall = new THREE.MeshToonMaterial({ map: textures().tireWall, color: '#ffffff' });
    for (const side of [1, -1]) {
      const arr = side > 0 ? this.barrierL : this.barrierR;
      const rails: THREE.BufferGeometry[] = [];
      const walls: number[][] = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (!arr[i] || !arr[j]) continue;
        const a = this.at(i, off * side), b = this.at(j, off * side);
        const nx = -a.c.nx * side, nz = -a.c.nz * side;
        const tyres = this.gravel[i] === side;
        if (tyres) {
          walls.push([a.x, a.z, b.x, b.z, nx, nz, a.c.s, j === 0 ? g.length : b.c.s]);
          continue;
        }
        // W-beam rail: two stacked boxes following the line
        for (const [y, hgt] of [[0.55, 0.16], [0.82, 0.12]]) {
          const pts = [
            [a.x, y, a.z], [b.x, y, b.z], [a.x, y + hgt, a.z],
            [a.x, y + hgt, a.z], [b.x, y, b.z], [b.x, y + hgt, b.z],
          ];
          const face = new THREE.BufferGeometry();
          face.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
          face.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(6).fill([nx, 0, nz]).flat(), 3));
          rails.push(face);
        }
        if (i % 3 === 0) posts.push({ x: a.x - nx * 0.12, z: a.z - nz * 0.12, rot: Math.atan2(nx, nz), scale: 1 });
      }
      if (rails.length) {
        const mesh = new THREE.Mesh(mergeGeometries(rails), steel);
        (mesh.material as THREE.Material).side = THREE.DoubleSide;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      if (walls.length) {
        // stacked tyre wall: a thick band with a tyre texture, 1.1 m high
        const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
        for (const [ax, az, bx, bz, nx, nz, sa, sb] of walls) {
          for (const d of [0, 0.9]) {
            const q = [[ax - nx * d, 0, az - nz * d, sa], [bx - nx * d, 0, bz - nz * d, sb], [ax - nx * d, 1.1, az - nz * d, sa],
              [ax - nx * d, 1.1, az - nz * d, sa], [bx - nx * d, 0, bz - nz * d, sb], [bx - nx * d, 1.1, bz - nz * d, sb]];
            for (const [x, y, z, s] of q) { pos.push(x, y, z); uv.push(s / 4, y / 1.1); nrm.push(d ? -nx : nx, 0, d ? -nz : nz); }
          }
          const top = [[ax, az], [bx, bz], [ax - nx * 0.9, az - nz * 0.9], [ax - nx * 0.9, az - nz * 0.9], [bx, bz], [bx - nx * 0.9, bz - nz * 0.9]];
          for (const [x, z] of top) { pos.push(x, 1.1, z); uv.push(0.5, 0.5); nrm.push(0, 1, 0); }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        tireWall.side = THREE.DoubleSide;
        tireWall.gradientMap = (steel as THREE.MeshToonMaterial).gradientMap;
        const mesh = new THREE.Mesh(geo, tireWall);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
    // armco posts as one instanced mesh
    if (posts.length) {
      const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.95, 0.12).translate(0, 0.47, 0), toon('#8d949c'), posts.length);
      const m4 = new THREE.Matrix4();
      posts.forEach((p, i) => post.setMatrixAt(i, m4.makeRotationY(p.rot).setPosition(p.x, 0, p.z)));
      post.castShadow = true;
      this.group.add(post);
    }
  }

  /** 150 / 100 / 50 m braking boards before corners that follow a straight. */
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
    const tex: Record<number, THREE.Texture> = { 150: boardTex('150'), 100: boardTex('100'), 50: boardTex('50') };
    const post = toon('#e6e6e6');
    let lastEntry = -1e9;
    for (let i = 0; i < N; i++) {
      if (Math.abs(g.samples[i].curv) < 1 / 70) continue;
      let e = i;
      while (Math.abs(g.at(e).curv) > 1 / 180 && i - e < 200) e--;
      let straight = true;
      for (let k = 1; k < 170; k++) if (Math.abs(g.at(e - k).curv) > 1 / 180) { straight = false; break; }
      const sEntry = g.at(e).s;
      if (!straight || Math.abs(sEntry - lastEntry) < 150) continue;
      lastEntry = sEntry;
      const side = g.samples[i].curv > 0 ? -1 : 1;
      for (const d of [150, 100, 50]) {
        const p = g.pointAt(sEntry - d);
        const off = (g.width / 2 + 3) * side;
        const grp = new THREE.Group();
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.08), [post, post, post, post, toon('#ffffff', { map: tex[d] }), post]);
        board.position.y = 1.4;
        grp.add(board);
        for (const x of [-0.55, 0.55]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), post);
          pole.position.set(x, 0.45, 0);
          grp.add(pole);
        }
        grp.position.set(p.x + p.nx * off, 0, p.z + p.nz * off);
        grp.rotation.y = Math.atan2(p.tx, p.tz) + Math.PI;
        grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        this.group.add(grp);
      }
      i += 60;
    }
  }

  private instanced(name: string, list: Placement[], shadows = true) {
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
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      for (let i = 0; i < list.length; i++) {
        tmp.multiplyMatrices(mats[i], mesh.matrixWorld);
        im.setMatrixAt(i, tmp);
      }
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
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

  private free(x: number, z: number, r: number, trackGap: number) {
    if (this.geo.distanceTo(x, z, 2) < this.geo.width / 2 + trackGap + r) return false;
    return this.occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
  }

  private buildScenery() {
    const g = this.geo;
    const R = rng(hashString(this.data.id + this.data.points.length));
    const b = g.bounds;
    const hw = g.width / 2;
    const off = this.barrierOffset;
    const occ = this.occupied;
    const face = (nx: number, nz: number) => Math.atan2(nx, nz);
    const outside = off - hw + 3; // clearance from the centre line to stay behind the barriers

    // grandstand + pits along the start straight
    const placedSides: number[] = [];
    for (const [name, d, sOff, r] of [['grandstand', 26, 45, 15], ['pit_building', 28, 45, 16]] as [string, number, number, number][]) {
      for (const side of [1, -1]) {
        if (placedSides.includes(side)) continue;
        const p = g.pointAt(sOff);
        const x = p.x + p.nx * (hw + d) * side, z = p.z + p.nz * (hw + d) * side;
        if (!this.free(x, z, r, 10)) continue;
        this.single(name, x, z, face(-p.nx * side, -p.nz * side));
        occ.push({ x, z, r });
        placedSides.push(side);
        if (name === 'pit_building') {
          for (let k = 0; k < 3; k++) {
            const q = g.pointAt(sOff + 24 + k * 8);
            const tx = q.x + q.nx * (hw + d + 2) * side, tz = q.z + q.nz * (hw + d + 2) * side;
            if (this.free(tx, tz, 3, 8)) { this.single('tent', tx, tz, face(-q.nx * side, -q.nz * side)); occ.push({ x: tx, z: tz, r: 3 }); }
          }
          for (const ds of [-18, 60]) {
            const q = g.pointAt(sOff + ds);
            const tx = q.x + q.nx * (hw + d - 6) * side, tz = q.z + q.nz * (hw + d - 6) * side;
            if (this.free(tx, tz, 2, 5)) { this.single('light_tower', tx, tz, face(-q.nx * side, -q.nz * side)); occ.push({ x: tx, z: tz, r: 2 }); }
          }
        } else {
          for (const ds of [-30, 30]) {
            const q = g.pointAt(sOff + ds);
            const tx = q.x + q.nx * (hw + d - 8) * side, tz = q.z + q.nz * (hw + d - 8) * side;
            if (this.free(tx, tz, 1, 4)) { this.single('flag_pole', tx, tz, face(-q.nx * side, -q.nz * side)); occ.push({ x: tx, z: tz, r: 1 }); }
          }
        }
        break;
      }
    }

    // corner furniture: spectators behind catch fences, marshal posts, TV towers, extra grandstands
    const fences: Placement[] = [];
    const crowds: Placement[] = [];
    const tires: Placement[] = [];
    let lastCorner = -1e9, cornerNo = 0;
    for (let i = 0; i < g.count; i++) {
      const c = g.samples[i];
      if (Math.abs(c.curv) < 1 / 60) continue;
      const pv = Math.abs(g.at(i - 1).curv), nx = Math.abs(g.at(i + 1).curv);
      if (Math.abs(c.curv) < pv || Math.abs(c.curv) < nx || c.s - lastCorner < 120) continue;
      lastCorner = c.s;
      cornerNo++;
      const side = c.curv > 0 ? -1 : 1; // outside of the corner
      const arr = side > 0 ? this.barrierL : this.barrierR;
      // fence + crowd over ~60 m of the outside
      for (let k = -30; k <= 30; k += 4) {
        const j = (i + k + g.count) % g.count;
        if (!arr[j]) continue;
        const p = this.at(j, (off + 2.5) * side);
        const tang = Math.atan2(-p.c.tz, p.c.tx); // fence spans local X -> along the track
        fences.push({ x: p.x, z: p.z, rot: tang, scale: 1 });
        if (k % 12 === 0 && R.next() > 0.3) {
          const q = this.at(j, (off + 5) * side);
          if (this.free(q.x, q.z, 2.5, off - hw + 3)) crowds.push({ x: q.x, z: q.z, rot: face(-p.c.nx * side, -p.c.nz * side), scale: 1 });
        }
      }
      // marshal post just after the apex
      const mj = (i + 25) % g.count;
      if (arr[mj]) {
        const q = this.at(mj, (off + 3) * side);
        if (this.free(q.x, q.z, 2, off - hw + 1)) { this.single('marshal_post', q.x, q.z, face(-q.c.nx * side, -q.c.nz * side)); occ.push({ x: q.x, z: q.z, r: 2 }); }
      }
      if (cornerNo % 3 === 1) {
        const q = this.at((i + 12) % g.count, (off + 12) * side);
        if (this.free(q.x, q.z, 2.5, off - hw + 6)) { this.single('tv_tower', q.x, q.z, face(-q.c.nx * side, -q.c.nz * side)); occ.push({ x: q.x, z: q.z, r: 2.5 }); }
      }
      if (cornerNo === 2) {
        const q = this.at(i, (off + 20) * side);
        if (this.free(q.x, q.z, 14, off - hw + 10)) { this.single('grandstand', q.x, q.z, face(-q.c.nx * side, -q.c.nz * side)); occ.push({ x: q.x, z: q.z, r: 14 }); }
      }
    }
    // tyre stacks at the ends of each tyre wall
    for (let i = 0; i < g.count; i++) {
      for (const side of [1, -1]) {
        if (this.gravel[i] !== side || this.gravel[(i + 1) % g.count] === side) continue;
        const p = this.at(i, (off - 0.5) * side);
        tires.push({ x: p.x, z: p.z, rot: R.range(0, 6), scale: 1 }, { x: p.x + p.c.tx * 1.2, z: p.z + p.c.tz * 1.2, rot: R.range(0, 6), scale: 1 });
      }
    }
    this.instanced('fence', fences, false);
    this.instanced('crowd', crowds);
    this.instanced('tire_stack', tires);
    for (const f of fences) occ.push({ x: f.x, z: f.z, r: 2 });

    // apex cones
    const cones: Placement[] = [];
    for (let i = 0; i < g.count; i++) {
      const c = g.samples[i];
      if (Math.abs(c.curv) < 1 / 60) continue;
      if (Math.abs(c.curv) >= Math.abs(g.at(i - 1).curv) && Math.abs(c.curv) >= Math.abs(g.at(i + 1).curv)) {
        const side = c.curv > 0 ? 1 : -1;
        const d = (hw + KERB_W + 1.2) * side;
        cones.push({ x: c.x + c.nx * d, z: c.z + c.nz * d, rot: 0, scale: 1.2 });
      }
    }
    this.instanced('cone', cones);

    // billboards along the straights
    for (let s = 120; s < g.length - 60; s += R.range(150, 260)) {
      const p = g.pointAt(s);
      const side = R.next() > 0.5 ? 1 : -1;
      const d = off + 6;
      const x = p.x + p.nx * d * side, z = p.z + p.nz * d * side;
      if (!this.free(x, z, 5, outside)) continue;
      this.single('billboard', x, z, face(-p.nx * side, -p.nz * side));
      occ.push({ x, z, r: 5 });
    }

    // vegetation: forest clusters + scattered trees
    const lists: Record<string, Placement[]> = {
      tree_orange: [], tree_pink: [], tree_yellow: [], tree_green: [], tree_red: [], tree_pine2: [], bush_pink: [], bush_yellow: [], basalt: [], rock: [],
    };
    const margin = 320;
    const area = (b.maxX - b.minX + 2 * margin) * (b.maxZ - b.minZ + 2 * margin);
    const clusters = Math.max(6, Math.round(area / 60000));
    const kinds = ['tree_orange', 'tree_pink', 'tree_yellow', 'tree_green', 'tree_red', 'tree_pine2'];
    for (let cI = 0; cI < clusters; cI++) {
      const cx = R.range(b.minX - margin, b.maxX + margin), cz = R.range(b.minZ - margin, b.maxZ + margin);
      const main = kinds[Math.floor(R.next() * kinds.length)];
      const count = 12 + Math.floor(R.next() * 26);
      const spread = R.range(18, 45);
      for (let k = 0; k < count; k++) {
        const a = R.range(0, Math.PI * 2), rr = Math.sqrt(R.next()) * spread;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        if (!this.free(x, z, 2.5, outside + 2)) continue;
        const kind = R.next() < 0.75 ? main : kinds[Math.floor(R.next() * kinds.length)];
        lists[kind].push({ x, z, rot: R.range(0, Math.PI * 2), scale: R.range(0.8, 1.45) });
        occ.push({ x, z, r: 1.6 });
      }
    }
    for (let k = 0; k < 260; k++) {
      const x = R.range(b.minX - margin, b.maxX + margin), z = R.range(b.minZ - margin, b.maxZ + margin);
      const roll = R.next();
      const kind = roll < 0.2 ? 'tree_orange' : roll < 0.32 ? 'tree_pink' : roll < 0.42 ? 'tree_yellow' : roll < 0.6 ? 'bush_pink' : roll < 0.76 ? 'bush_yellow' : roll < 0.86 ? 'tree_red' : roll < 0.93 ? 'basalt' : 'rock';
      if (!this.free(x, z, 2, outside + 1)) continue;
      lists[kind].push({ x, z, rot: R.range(0, Math.PI * 2), scale: R.range(0.8, 1.4) });
      occ.push({ x, z, r: 1.5 });
    }
    for (const k of Object.keys(lists)) this.instanced(k, lists[k]);

    // grass clumps & flowers close to the track (cheap detail near the camera)
    const tufts: Placement[] = [], flowers: Placement[] = [], tall: Placement[] = [], greenTufts: Placement[] = [];
    for (let k = 0; k < Math.min(9000, g.length * 4.5); k++) {
      const i = Math.floor(R.next() * g.count);
      const side = R.next() > 0.5 ? 1 : -1;
      const lat = hw + KERB_W + 1.2 + Math.pow(R.next(), 1.8) * 55; // denser close to the tarmac
      if (this.gravel[i] === side && lat < hw + KERB_W + GRAVEL_W + 1) continue;
      const p = this.at(i, lat * side);
      if (g.distanceTo(p.x, p.z, 3) < hw + KERB_W + 1) continue;
      const roll = R.next();
      const list = roll < 0.6 ? tufts : roll < 0.78 ? greenTufts : roll < 0.9 ? tall : flowers;
      list.push({ x: p.x, z: p.z, rot: R.range(0, 6.28), scale: R.range(0.8, 1.6) });
    }
    this.instanced('grass_clump', tufts, false);
    this.instanced('grass_clump_green', greenTufts, false);
    this.instanced('grass_tall', tall, false);
    this.instanced('flowers', flowers, false);
    this.buildLanterns(R);

    // horizon mountains
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rad = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 1050;
    const mount: Placement[] = [], snowy: Placement[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + R.range(-0.1, 0.1);
      const d = rad + R.range(-80, 180);
      (R.next() < 0.4 ? snowy : mount).push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, rot: R.range(0, 6.28), scale: R.range(1.2, 2.4) });
    }
    this.instanced('mountain', mount, false);
    this.instanced('mountain_snow', snowy, false);

    // sky decorations
    const span = rad * 0.8;
    for (let i = 0; i < 24; i++) {
      const o = this.single('cloud', cx + R.range(-span, span), cz + R.range(-span, span), R.range(0, 6), R.range(3, 6), R.range(130, 220));
      o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { (m as THREE.Mesh).castShadow = false; m.userData.noOutline = true; } });
      this.floaters.push({ obj: o, speed: R.range(0.6, 1.6), phase: 0, base: o.position.clone() });
    }
    for (let i = 0; i < 3; i++) {
      const o = this.single('balloon', cx + R.range(-span * 0.4, span * 0.4), cz + R.range(-span * 0.4, span * 0.4), R.range(0, 6), 1.6, R.range(50, 90));
      o.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).castShadow = false; });
      this.floaters.push({ obj: o, speed: R.range(0.5, 1), phase: R.range(0, 6), base: o.position.clone() });
    }
  }

  private poolMat: THREE.MeshBasicMaterial | null = null;

  /** stone lanterns along the track (glow at night, with fake light pools on the ground) */
  private buildLanterns(R: ReturnType<typeof rng>) {
    const g = this.geo;
    const hw = g.width / 2;
    const lanterns: Placement[] = [], lamps: Placement[] = [];
    let side = 1;
    for (let s = 20; s < g.length - 10; s += 30) {
      side = -side;
      const i = Math.floor((s / g.length) * g.count);
      if (this.gravel[i] === side) continue;
      const d = (hw + KERB_W + 2.6) * side;
      const p = this.at(i, d);
      if (!this.free(p.x, p.z, 0.8, KERB_W + 2)) continue;
      lanterns.push({ x: p.x, z: p.z, rot: R.range(0, 6.28), scale: 1.1 });
    }
    // street lamps along the start straight
    for (let k = -3; k <= 3; k++) {
      for (const sd of [1, -1]) {
        const p = g.pointAt(k * 24 + 10);
        const x = p.x + p.nx * (hw + KERB_W + 4) * sd, z = p.z + p.nz * (hw + KERB_W + 4) * sd;
        lamps.push({ x, z, rot: Math.atan2(-p.nx * sd, -p.nz * sd) + Math.PI, scale: 1.2 });
      }
    }
    this.instanced('lantern', lanterns);
    this.instanced('street_lamp', lamps);
    // additive light pools
    const pools = [...lanterns.map((l) => ({ ...l, r: 6.5 })), ...lamps.map((l) => ({ ...l, r: 9 }))];
    if (!pools.length) return;
    const tex = canvasTexture(128, 128, (c) => {
      const grd = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,200,110,1)');
      grd.addColorStop(0.45, 'rgba(255,160,80,0.45)');
      grd.addColorStop(1, 'rgba(255,140,60,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, 128, 128);
    }, false);
    this.poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false });
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.poolMat, pools.length);
    const m4 = new THREE.Matrix4();
    pools.forEach((p, i) => im.setMatrixAt(i, m4.makeScale(p.r, 1, p.r).setPosition(p.x, 0.07, p.z)));
    im.userData.noOutline = true;
    im.renderOrder = 4;
    this.group.add(im);
  }

  setNight(n: number) {
    if (this.poolMat) {
      this.poolMat.opacity = Math.min(1, n * 1.6);
      this.poolMat.visible = n > 0.02;
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
