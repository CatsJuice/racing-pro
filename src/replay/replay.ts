import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Screen } from '../app';
import { CarVisual } from '../car/carVisual';
import { ASSIST_LABELS } from '../car/physics';
import { fetchBoard, fetchOnlineLap } from '../core/online';
import { F, FRAME_STRIDE, fmtDelta, fmtTime, getLap, getPrefs, getTrack, lapsForTrack, type LapRecord } from '../core/storage';
import { isOfficial } from '../track/official';
import { toLeaderboard, toReplay } from '../nav';
import { loadAssets } from '../render/assets';
import { Environment } from '../render/environment';
import { FallingLeaves } from '../game/effects';
import { getStage } from '../render/toon';
import { timeControls } from '../ui/timeControls';
import { TrackScene } from '../track/trackScene';
import { h } from '../ui/dom';
import { cssColor, frameCount, get, sampleAt, speedColor, timeAtDistance } from './frames';

type ColorMode = 'speed' | 'pedal';

interface LineInfo {
  mesh: THREE.Mesh;
  quads: number;
  width: { value: number };
  baseWidth: number;
}

export class ReplayScreen implements Screen {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
  private controls!: OrbitControls;
  private lap!: LapRecord;
  private cmp: LapRecord | null = null;
  private track!: TrackScene;
  private car!: CarVisual;
  private cmpCar: CarVisual | null = null;
  private env!: Environment;
  private leaves = new FallingLeaves();
  private line: LineInfo | null = null;
  private cmpLine: LineInfo | null = null;
  private markers = new THREE.Group();
  private t = 0;
  private playing = true;
  private rate = 1;
  private follow = true;
  private fullLine = false;
  private colorMode: ColorMode = 'speed';
  private frame = new Float32Array(FRAME_STRIDE);
  private cmpFrame = new Float32Array(FRAME_STRIDE);
  private prevTarget = new THREE.Vector3();
  private minV = 0;
  private maxV = 1;
  private ui: Record<string, HTMLElement> = {};
  private chart!: HTMLCanvasElement;
  private chartBase: HTMLCanvasElement | null = null;
  private scrub!: HTMLInputElement;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private deltaHint = 0;

  /** `compareId` may be prefixed with "o:" (global board) or "l:" (local history). */
  constructor(private lapId: string, private compareId?: string, private online = false) {}

  private async load(ref: string, online: boolean): Promise<LapRecord | null> {
    if (ref.startsWith('o:')) return fetchOnlineLap(ref.slice(2));
    if (ref.startsWith('l:')) return (await getLap(ref.slice(2))) ?? null;
    return online ? fetchOnlineLap(ref) : (await getLap(ref)) ?? null;
  }

  async mount(root: HTMLElement) {
    root.append(h('div', { class: 'loading' }, '加载回放…'));
    await loadAssets();
    let lap: LapRecord | null = null;
    let err = '找不到这条圈速记录';
    try {
      lap = await this.load(this.lapId, this.online);
      if (lap && this.compareId) this.cmp = await this.load(this.compareId, this.online).catch(() => null);
    } catch (e) {
      err = (e as Error).message;
    }
    root.innerHTML = '';
    if (!lap) {
      root.append(h('div', { class: 'screen center' }, h('div', { class: 'panel' }, h('p', null, err), h('button', { class: 'btn', onclick: () => toLeaderboard() }, '返回'))));
      return;
    }
    this.lap = lap;
    const trackData = getTrack(lap.trackId);
    if (!trackData) {
      root.append(h('div', { class: 'screen center' }, h('div', { class: 'panel' }, h('p', null, '赛道已被删除'), h('button', { class: 'btn', onclick: () => toLeaderboard() }, '返回'))));
      return;
    }

    const prefs = getPrefs();
    this.env = new Environment(this.scene, { shadowSize: 90, hour: prefs.hour ?? 16.8 });
    this.env.speed = prefs.timeFlow ?? 0;
    this.track = new TrackScene(trackData);
    this.scene.add(this.track.group);
    this.car = new CarVisual(lap.car);
    this.car.motionScale = 2.2;
    this.scene.add(this.car.root);
    if (this.cmp) {
      this.cmpCar = new CarVisual(this.cmp.car, { ghost: true, ghostColor: '#ff9ff3' });
      this.scene.add(this.cmpCar.root);
    }

    // speed range
    const n = frameCount(lap.frames);
    let mn = Infinity, mx = 0;
    for (let i = 0; i < n; i++) {
      const v = get(lap.frames, i, F.speed);
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
    if (this.cmp) {
      for (let i = 0; i < frameCount(this.cmp.frames); i++) {
        const v = get(this.cmp.frames, i, F.speed);
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
      }
    }
    this.minV = mn;
    this.maxV = Math.max(mn + 1, mx);
    this.scene.add(this.leaves.mesh);
    this.env.collect();
    this.rebuildLines();
    this.buildMarkers();
    this.scene.add(this.markers);

    const { renderer } = getStage();
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 1500;
    sampleAt(lap.frames, 0, this.frame);
    const cx = this.frame[F.x], cz = this.frame[F.z];
    const hd = this.frame[F.heading];
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx - Math.sin(hd) * 34 + Math.cos(hd) * 22, 48, cz - Math.cos(hd) * 34 - Math.sin(hd) * 22);
    this.prevTarget.set(cx, 0, cz);
    this.controls.update();

    this.buildUI(root);
    window.addEventListener('keydown', this.keyHandler);
  }

  // ------------------------------------------------------------------ racing line
  private lineColor(frames: Float32Array, i: number): [number, number, number] {
    if (this.colorMode === 'speed') return speedColor((get(frames, i, F.speed) - this.minV) / (this.maxV - this.minV));
    const b = get(frames, i, F.brake), th = get(frames, i, F.throttle);
    if (b > 0.05) return [0.95, 0.2 + (1 - b) * 0.4, 0.2];
    if (th > 0.05) return [0.25 + (1 - th) * 0.4, 0.85, 0.3];
    return [0.85, 0.85, 0.85];
  }

  private buildLine(frames: Float32Array, width: number, y: number, tint?: [number, number, number]): LineInfo {
    const n = frameCount(frames);
    const pos = new Float32Array((n - 1) * 6 * 3);
    const col = new Float32Array((n - 1) * 6 * 3);
    const off = new Float32Array((n - 1) * 6 * 2);
    const side = (i: number) => {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let dx = get(frames, b, F.x) - get(frames, a, F.x), dz = get(frames, b, F.z) - get(frames, a, F.z);
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      return [dz, -dx];
    };
    let q = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = get(frames, i, F.x), az = get(frames, i, F.z), bx = get(frames, i + 1, F.x), bz = get(frames, i + 1, F.z);
      const [sax, saz] = side(i), [sbx, sbz] = side(i + 1);
      // colours are authored in sRGB; vertex colours are linear
      const lin = (c: readonly number[]) => c.map((v) => Math.pow(v, 2.2)) as [number, number, number];
      const ca = lin(tint ?? this.lineColor(frames, i)), cb = lin(tint ?? this.lineColor(frames, i + 1));
      // centre positions + side offsets; the shader widens the ribbon with camera distance
      const verts = [
        [ax, az, sax, saz, ca], [ax, az, -sax, -saz, ca], [bx, bz, sbx, sbz, cb],
        [ax, az, -sax, -saz, ca], [bx, bz, -sbx, -sbz, cb], [bx, bz, sbx, sbz, cb],
      ] as const;
      verts.forEach(([x, z, ox, oz, c], k) => {
        pos.set([x, y, z], (q * 6 + k) * 3);
        off.set([ox, oz], (q * 6 + k) * 2);
        col.set(c, (q * 6 + k) * 3);
      });
      q++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('sideOffset', new THREE.BufferAttribute(off, 2));
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, fog: false });
    const uWidth = { value: width };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWidth = uWidth;
      sh.vertexShader = 'attribute vec2 sideOffset;\nuniform float uWidth;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz += sideOffset * uWidth;');
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.noOutline = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return { mesh, quads: q, width: uWidth, baseWidth: width };
  }

  private rebuildLines() {
    for (const l of [this.line, this.cmpLine]) {
      if (l) { l.mesh.removeFromParent(); l.mesh.geometry.dispose(); }
    }
    this.line = this.buildLine(this.lap.frames, 0.55, 0.08);
    this.scene.add(this.line.mesh);
    if (this.cmp) {
      this.cmpLine = this.buildLine(this.cmp.frames, 0.22, 0.075, [1, 0.62, 0.95]);
      this.scene.add(this.cmpLine.mesh);
    }
  }

  /** Pins where braking starts, labelled with entry speed. */
  private buildMarkers() {
    const f = this.lap.frames;
    const n = frameCount(f);
    let lastOff = 0;
    for (let i = 1; i < n; i++) {
      const b = get(f, i, F.brake), pb = get(f, i - 1, F.brake);
      if (pb < 0.1) lastOff += get(f, i, F.t) - get(f, i - 1, F.t);
      if (b >= 0.25 && pb < 0.25 && lastOff > 0.6) {
        this.addMarker(get(f, i, F.x), get(f, i, F.z), get(f, i, F.speed) * 3.6);
        lastOff = 0;
      }
      if (b >= 0.1) lastOff = 0;
    }
  }

  private addMarker(x: number, z: number, kmh: number) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 6), new THREE.MeshBasicMaterial({ color: '#ff3b3b' }));
    pole.position.y = 1.5;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 96;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#ff3b3b';
    c.beginPath();
    c.roundRect(4, 4, 248, 88, 26);
    c.fill();
    c.fillStyle = '#fff';
    c.font = 'bold 50px "Baloo 2", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`刹 ${Math.round(kmh)}`, 128, 52);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
    sp.scale.set(5, 1.9, 1);
    sp.position.y = 4.2;
    sp.renderOrder = 10;
    g.add(pole, sp);
    pole.userData.noOutline = true;
    g.position.set(x, 0, z);
    this.markers.add(g);
  }

  // ------------------------------------------------------------------ UI
  private buildUI(root: HTMLElement) {
    root.className = 'replay';
    const lap = this.lap;
    const legend = h('div', { class: 'legend' });
    this.ui.legend = legend;
    this.renderLegend();
    this.chart = h('canvas', { class: 'tele-chart' });
    this.chart.addEventListener('pointerdown', (e) => this.onChartPointer(e));
    this.chart.addEventListener('pointermove', (e) => { if (e.buttons) this.onChartPointer(e); });
    this.scrub = h('input', { type: 'range', min: '0', max: String(lap.time), step: '0.01', value: '0', class: 'scrub' });
    this.scrub.addEventListener('input', () => { this.t = parseFloat(this.scrub.value); });
    const playBtn = h('button', { class: 'btn icon', onclick: () => { this.playing = !this.playing; this.syncButtons(); } }, '⏸');
    this.ui.play = playBtn;
    const rates = [0.25, 0.5, 1, 2, 4];
    const rateBtns = rates.map((r) => h('button', { class: 'chip' + (r === 1 ? ' on' : ''), onclick: () => { this.rate = r; this.syncButtons(); } }, `${r}x`));
    this.ui.rates = h('div', { class: 'chips' }, rateBtns);
    const followBtn = h('button', { class: 'chip on', onclick: () => { this.follow = !this.follow; this.syncButtons(); } }, '跟随赛车');
    const fullBtn = h('button', { class: 'chip', onclick: () => { this.fullLine = !this.fullLine; this.syncButtons(); } }, '完整路线');
    const overviewBtn = h('button', { class: 'chip', onclick: () => this.overview() }, '全景');
    const colorBtn = h('button', { class: 'chip', onclick: () => { this.colorMode = this.colorMode === 'speed' ? 'pedal' : 'speed'; this.rebuildLines(); this.renderLegend(); this.syncButtons(); } }, '着色：速度');
    const markerBtn = h('button', { class: 'chip on', onclick: () => { this.markers.visible = !this.markers.visible; this.syncButtons(); } }, '刹车点');
    this.ui.follow = followBtn;
    this.ui.full = fullBtn;
    this.ui.color = colorBtn;
    this.ui.marker = markerBtn;

    this.ui.speed = h('div', { class: 'big mono' }, '0');
    this.ui.gear = h('div', { class: 'gear' }, '1');
    this.ui.rpm = h('div', { class: 'mono dim' }, '');
    this.ui.thr = h('div', { class: 'pedal-fill thr' });
    this.ui.brk = h('div', { class: 'pedal-fill brk' });
    this.ui.time = h('div', { class: 'mono' }, '0:00.000');
    this.ui.delta = h('div', { class: 'mono' }, '');

    const cmpSelect = h('select', { class: 'select', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      toReplay(this.lap.id, v || undefined, this.online);
    } }, h('option', { value: '' }, '不对比'));
    const addOpt = (value: string, label: string, group: HTMLElement) => {
      const o = h('option', { value }, label);
      if (value === this.compareId || value.slice(2) === this.compareId) o.selected = true;
      group.append(o);
    };
    if (isOfficial(lap.trackId)) {
      const g = h('optgroup', { label: '全球榜' });
      cmpSelect.append(g);
      fetchBoard(lap.trackId, 50).then((b) => b.entries.filter((e) => e.lapId !== lap!.id).forEach((e) => {
        addOpt('o:' + e.lapId, `#${b.entries.indexOf(e) + 1} ${fmtTime(e.time)} · ${e.name}`, g);
      })).catch(() => {});
    }
    const lg = h('optgroup', { label: '本地记录' });
    cmpSelect.append(lg);
    lapsForTrack(lap.trackId).then((ls) => ls.filter((l) => l.id !== lap!.id).forEach((l, i) => {
      addOpt('l:' + l.id, `#${i + 1} ${fmtTime(l.time)} · ${l.carName}`, lg);
    }));

    root.append(
      h('div', { class: 'replay-top panel' },
        h('button', { class: 'btn ghost', onclick: () => toLeaderboard(lap.trackId) }, '← 圈速榜'),
        h('div', { class: 'replay-title' },
          h('div', { class: 'title' }, `${lap.trackName} · ${fmtTime(lap.time)}${lap.playerName ? ` · 👤 ${lap.playerName}` : ''}`),
          h('div', { class: 'dim' }, `${lap.carName} · ${lap.car.drivetrain} · 辅助${ASSIST_LABELS[lap.assist ?? 'pro']}${lap.rewinds ? ` · ⏪${lap.rewinds}` : ''} · ${new Date(lap.date).toLocaleString()} · 极速 ${Math.round(lap.topSpeed)} km/h · 分段 ${lap.sectors.map((s) => s.toFixed(2)).join(' / ')}`),
        ),
        h('div', { class: 'row' }, h('span', { class: 'dim' }, '对比：'), cmpSelect),
      ),
      h('div', { class: 'replay-side panel' },
        h('div', { class: 'row between' }, h('label', null, '时间'), this.ui.time),
        this.cmp ? h('div', { class: 'row between' }, h('label', null, '对比差'), this.ui.delta) : null,
        h('div', { class: 'speed-row' }, this.ui.speed, h('span', { class: 'unit' }, 'km/h'), this.ui.gear),
        this.ui.rpm,
        h('div', { class: 'pedals' }, h('div', { class: 'pedal' }, this.ui.brk), h('div', { class: 'pedal' }, this.ui.thr)),
        legend,
        h('details', { class: 'time-details' }, h('summary', null, '🌗 时间与画面'), timeControls(this.env)),
        h('div', { class: 'hint dim' }, '左键拖动旋转 · 右键平移 · 滚轮缩放', h('br'), '空格 播放/暂停 · ←/→ 快退/快进'),
      ),
      h('div', { class: 'replay-bottom panel' },
        h('div', { class: 'row' }, playBtn, this.scrub),
        this.chart,
        h('div', { class: 'row wrap' }, this.ui.rates, followBtn, overviewBtn, fullBtn, colorBtn, markerBtn),
      ),
    );
    requestAnimationFrame(() => this.drawChartBase());
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => this.drawChartBase();

  private renderLegend() {
    const el = this.ui.legend;
    if (!el) return;
    el.innerHTML = '';
    if (this.colorMode === 'speed') {
      const stops = [0, 0.25, 0.5, 0.75, 1].map((k) => `${cssColor(speedColor(k))} ${k * 100}%`).join(',');
      el.append(
        h('div', { class: 'legend-title' }, '路线颜色 = 速度'),
        h('div', { class: 'legend-bar', style: { background: `linear-gradient(90deg, ${stops})` } }),
        h('div', { class: 'row between mono dim' }, h('span', null, `${Math.round(this.minV * 3.6)}`), h('span', null, `${Math.round(this.maxV * 3.6)} km/h`)),
      );
    } else {
      el.append(
        h('div', { class: 'legend-title' }, '路线颜色 = 踏板'),
        h('div', { class: 'row legend-keys' },
          h('span', null, h('i', { style: { background: '#43d34d' } }), '油门'),
          h('span', null, h('i', { style: { background: '#f23333' } }), '刹车'),
          h('span', null, h('i', { style: { background: '#d9d9d9' } }), '滑行'),
        ),
      );
    }
    if (this.cmp) el.append(h('div', { class: 'row legend-keys' }, h('span', null, h('i', { style: { background: '#ff9ff3' } }), `对比圈 ${fmtTime(this.cmp.time)}`)));
  }

  private syncButtons() {
    this.ui.play.textContent = this.playing ? '⏸' : '▶';
    Array.from(this.ui.rates.children).forEach((b, i) => b.classList.toggle('on', [0.25, 0.5, 1, 2, 4][i] === this.rate));
    this.ui.follow.classList.toggle('on', this.follow);
    this.ui.full.classList.toggle('on', this.fullLine);
    this.ui.marker.classList.toggle('on', this.markers.visible);
    this.ui.color.textContent = this.colorMode === 'speed' ? '着色：速度' : '着色：踏板';
  }

  private overview() {
    this.follow = false;
    this.syncButtons();
    const b = this.track.geo.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, span * 0.85, cz + span * 0.75);
    this.fullLine = true;
    this.syncButtons();
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); this.playing = !this.playing; this.syncButtons(); }
    if (e.code === 'ArrowLeft') this.t = Math.max(0, this.t - 2);
    if (e.code === 'ArrowRight') this.t = Math.min(this.lap.time, this.t + 2);
  }

  // ------------------------------------------------------------------ telemetry chart (speed vs distance)
  private drawChartBase() {
    const cv = this.chart;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) return;
    cv.width = w * dpr;
    cv.height = hgt * dpr;
    const base = document.createElement('canvas');
    base.width = cv.width;
    base.height = cv.height;
    const c = base.getContext('2d')!;
    c.scale(dpr, dpr);
    const L = this.track.geo.length;
    const pedalH = 12;
    const top = 6, bottom = hgt - pedalH - 6;
    const X = (s: number) => (s / L) * w;
    const Y = (v: number) => bottom - ((v - this.minV) / (this.maxV - this.minV)) * (bottom - top);
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      c.beginPath();
      c.moveTo(0, top + ((bottom - top) * k) / 4);
      c.lineTo(w, top + ((bottom - top) * k) / 4);
      c.stroke();
    }
    // sectors
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.setLineDash([4, 4]);
    for (const s of [L / 3, (2 * L) / 3]) {
      c.beginPath();
      c.moveTo(X(s), top);
      c.lineTo(X(s), hgt);
      c.stroke();
    }
    c.setLineDash([]);
    const trace = (frames: Float32Array, color: string | null, width: number) => {
      const n = frameCount(frames);
      for (let i = 0; i < n - 1; i++) {
        const sa = get(frames, i, F.s), sb = get(frames, i + 1, F.s);
        if (sb < sa) continue;
        c.strokeStyle = color ?? cssColor(speedColor((get(frames, i, F.speed) - this.minV) / (this.maxV - this.minV)));
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(X(sa), Y(get(frames, i, F.speed)));
        c.lineTo(X(sb), Y(get(frames, i + 1, F.speed)));
        c.stroke();
      }
    };
    if (this.cmp) trace(this.cmp.frames, 'rgba(255,159,243,0.85)', 1.5);
    trace(this.lap.frames, null, 2.5);
    // pedal strip
    const f = this.lap.frames;
    const n = frameCount(f);
    for (let i = 0; i < n - 1; i++) {
      const sa = get(f, i, F.s), sb = get(f, i + 1, F.s);
      if (sb < sa) continue;
      const b = get(f, i, F.brake), th = get(f, i, F.throttle);
      c.fillStyle = b > 0.05 ? `rgba(242,51,51,${0.3 + b * 0.7})` : th > 0.05 ? `rgba(67,211,77,${0.25 + th * 0.6})` : 'rgba(200,200,200,0.25)';
      c.fillRect(X(sa), hgt - pedalH, Math.max(1, X(sb) - X(sa) + 0.5), pedalH);
    }
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '10px "JetBrains Mono", monospace';
    c.fillText(`${Math.round(this.maxV * 3.6)}`, 4, top + 10);
    c.fillText(`${Math.round(this.minV * 3.6)}`, 4, bottom - 2);
    this.chartBase = base;
  }

  private onChartPointer(e: PointerEvent) {
    const r = this.chart.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const s = k * this.track.geo.length;
    this.t = timeAtDistance(this.lap.frames, s, 0).t;
  }

  private drawChart(s: number, cmpS: number | null) {
    const cv = this.chart;
    if (!this.chartBase || !cv) return;
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(this.chartBase, 0, 0);
    const dpr = cv.width / cv.clientWidth;
    const L = this.track.geo.length;
    if (cmpS != null) {
      c.fillStyle = '#ff9ff3';
      c.fillRect((cmpS / L) * cv.width - dpr, 0, 2 * dpr, cv.height);
    }
    c.fillStyle = '#fff';
    c.fillRect((s / L) * cv.width - dpr, 0, 2 * dpr, cv.height);
  }

  // ------------------------------------------------------------------ loop
  update(dt: number, time: number) {
    if (!this.lap || !this.controls) return;
    if (this.playing) {
      this.t += dt * this.rate;
      if (this.t > this.lap.time) this.t = 0;
    }
    this.scrub.value = String(this.t);
    const f = sampleAt(this.lap.frames, this.t, this.frame);
    const spin = f[F.s] / 0.32;
    this.car.update({
      x: f[F.x], z: f[F.z], heading: f[F.heading], pitch: f[F.pitch], roll: f[F.roll], heave: f[F.heave],
      steer: f[F.steer], wheelSpin: [spin, spin, spin, spin], brake: f[F.brake],
    });
    let cmpS: number | null = null;
    if (this.cmp && this.cmpCar) {
      const tc = Math.min(this.t, this.cmp.time);
      const g = sampleAt(this.cmp.frames, tc, this.cmpFrame);
      cmpS = g[F.s];
      const sp = g[F.s] / 0.32;
      this.cmpCar.update({
        x: g[F.x], z: g[F.z], heading: g[F.heading], pitch: g[F.pitch], roll: g[F.roll], heave: g[F.heave],
        steer: g[F.steer], wheelSpin: [sp, sp, sp, sp], brake: g[F.brake],
      });
      const r = timeAtDistance(this.cmp.frames, f[F.s], this.deltaHint);
      this.deltaHint = r.index;
      const d = this.t - r.t;
      this.ui.delta.textContent = fmtDelta(d);
      this.ui.delta.className = `mono ${d <= 0 ? 'good' : 'bad'}`;
    }
    // progressive line
    const n = frameCount(this.lap.frames);
    const idx = Math.min(n - 1, Math.floor(timeIndex(this.lap.frames, this.t)));
    if (this.line) this.line.mesh.geometry.setDrawRange(0, (this.fullLine ? this.line.quads : Math.max(0, idx)) * 6);
    if (this.cmpLine && this.cmp) {
      const ci = Math.floor(timeIndex(this.cmp.frames, Math.min(this.t, this.cmp.time)));
      this.cmpLine.mesh.geometry.setDrawRange(0, (this.fullLine ? this.cmpLine.quads : ci) * 6);
    }

    // camera follow keeps the user's orbit offset
    const target = new THREE.Vector3(f[F.x], 0.5, f[F.z]);
    if (this.follow) {
      const delta = target.clone().sub(this.prevTarget);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    this.prevTarget.copy(target);
    this.controls.update();
    this.env.update(dt, time);
    this.track.setNight(this.env.night);
    this.leaves.update(dt, this.controls.target.x, this.controls.target.z);
    this.env.follow(this.controls.target.x, this.controls.target.z);
    const camDist = this.camera.position.distanceTo(this.controls.target);
    // roughly constant on screen (~5 px for the main line), but never wider than a slice of the road
    const pxWorld = (2 * camDist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / window.innerHeight;
    const roadW = this.track.geo.width;
    for (const l of [this.line, this.cmpLine]) {
      if (!l) continue;
      const main = l === this.line;
      const half = Math.max(l.baseWidth, pxWorld * (main ? 2.6 : 1.3));
      l.width.value = Math.min(half, roadW * (main ? 0.14 : 0.07));
    }
    const ms = Math.max(1, camDist / 60);
    for (const m of this.markers.children) m.scale.setScalar(ms);
    this.track.setSkyVisible(this.camera.position.y < 90);
    this.track.update(time);

    this.ui.time.textContent = fmtTime(this.t);
    this.ui.speed.textContent = String(Math.round(f[F.speed] * 3.6));
    this.ui.gear.textContent = f[F.gear] < 0 ? 'R' : String(Math.round(f[F.gear]));
    this.ui.rpm.textContent = `${Math.round(f[F.rpm])} rpm`;
    this.ui.thr.style.height = `${f[F.throttle] * 100}%`;
    this.ui.brk.style.height = `${f[F.brake] * 100}%`;
    this.drawChart(Math.max(0, f[F.s]), cmpS);

    getStage().post.dofStrength = 0.7;
    getStage().render(this.scene, this.camera, this.env);
  }

  unmount() {
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.onResize);
    this.controls?.dispose();
    this.track?.dispose();
    this.car?.dispose();
    this.cmpCar?.dispose();
    this.scene.clear();
  }
}

function timeIndex(frames: Float32Array, t: number) {
  // frames are recorded at a fixed rate; binary search for robustness
  let lo = 0, hi = frameCount(frames) - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid * FRAME_STRIDE + F.t] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
