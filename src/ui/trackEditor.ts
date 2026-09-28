import type { Screen } from '../app';
import { getPrefs, listCars, saveTrack, setPrefs, uid } from '../core/storage';
import { toRace, toTracks } from '../nav';
import { drawTrack, fitView, makeView, type View2D } from '../track/draw2d';
import { simplifyStroke, splinePolyline, TrackGeometry, validateTrack, type TrackData, type Vec2 } from '../track/track';
import { confirmDialog, h, toast } from './dom';

type Tool = 'draw' | 'edit';

export class TrackEditorScreen implements Screen {
  private data: TrackData;
  private isNew: boolean;
  private canvas!: HTMLCanvasElement;
  private wrap!: HTMLElement;
  private view: View2D = makeView(1, 0, 0);
  private tool: Tool;
  private history: string[] = [];
  private stroke: Vec2[] | null = null;
  private dragIdx = -1;
  private hoverIdx = -1;
  private selected = -1;
  private panFrom: { x: number; y: number; ox: number; oy: number } | null = null;
  private spacing = 30;
  private dirty = false;
  private infoEl!: HTMLElement;
  private toolBtns: Record<Tool, HTMLElement> = {} as any;
  private startBtn!: HTMLButtonElement;
  private ro: ResizeObserver | null = null;
  private spaceHeld = false;

  constructor(track?: TrackData) {
    this.isNew = !track;
    this.data = track
      ? { ...track, points: track.points.map((p) => ({ ...p })) }
      : { id: uid('trk-'), name: '我的赛道', width: 13, points: [] };
    this.tool = this.data.points.length ? 'edit' : 'draw';
  }

  mount(root: HTMLElement) {
    root.className = 'editor';
    this.canvas = h('canvas', { class: 'editor-canvas' });
    this.wrap = h('div', { class: 'editor-stage' }, this.canvas);
    this.infoEl = h('div', { class: 'editor-info' });
    const nameInput = h('input', { class: 'text', value: this.data.name, maxlength: 24, oninput: (e: Event) => { this.data.name = (e.target as HTMLInputElement).value || '未命名赛道'; this.dirty = true; } });
    const widthVal = h('span', { class: 'mono' }, `${this.data.width} m`);
    const width = h('input', { type: 'range', min: '8', max: '24', step: '0.5', value: String(this.data.width) });
    width.addEventListener('pointerdown', () => this.pushHistory());
    width.addEventListener('input', () => { this.data.width = parseFloat(width.value); widthVal.textContent = `${this.data.width} m`; this.changed(); });
    const spacingVal = h('span', { class: 'mono' }, `${this.spacing} m`);
    const spacing = h('input', { type: 'range', min: '14', max: '70', step: '1', value: String(this.spacing) });
    spacing.addEventListener('input', () => { this.spacing = parseFloat(spacing.value); spacingVal.textContent = `${this.spacing} m`; });
    this.toolBtns.draw = h('button', { class: 'seg-btn', onclick: () => this.setTool('draw') }, '✏️ 手绘');
    this.toolBtns.edit = h('button', { class: 'seg-btn', onclick: () => this.setTool('edit') }, '🔘 编辑节点');
    this.startBtn = h('button', { class: 'btn small', disabled: true, onclick: () => this.setStart() }, '🏁 设为起点');

    root.append(
      this.wrap,
      h('div', { class: 'editor-side panel' },
        h('div', { class: 'row between' }, h('button', { class: 'btn ghost', onclick: () => this.back() }, '← 返回'), h('h2', null, this.isNew ? '新建赛道' : '编辑赛道')),
        h('div', { class: 'field' }, h('label', null, '名称'), nameInput),
        h('div', { class: 'field' }, h('label', null, '工具'), h('div', { class: 'seg' }, this.toolBtns.draw, this.toolBtns.edit)),
        h('div', { class: 'field' }, h('div', { class: 'row between' }, h('label', null, '赛道宽度'), widthVal), width),
        h('div', { class: 'field' }, h('div', { class: 'row between' }, h('label', null, '手绘节点间距（越大越平滑）'), spacingVal), spacing),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn small', onclick: () => this.undo() }, '↶ 撤销'),
          h('button', { class: 'btn small', onclick: () => this.reverse() }, '⇄ 反向行驶'),
          this.startBtn,
          h('button', { class: 'btn small', onclick: () => this.fit() }, '⤢ 适配视图'),
          h('button', { class: 'btn small', onclick: () => this.random() }, '🎲 随机生成'),
          h('button', { class: 'btn small danger', onclick: () => this.clearAll() }, '清空'),
        ),
        this.infoEl,
        h('div', { class: 'help dim' },
          h('p', null, h('b', null, '手绘：'), '按住左键画一个圈，松开自动闭合并转换为控制点。'),
          h('p', null, h('b', null, '编辑：'), '拖动节点移动；点击路面插入节点；双击或右键节点删除；点击节点选中后可“设为起点”。'),
          h('p', null, h('b', null, '视图：'), '滚轮缩放；右键/中键/空格+拖动 平移。黄色箭头为行驶方向，黑白线为起点。'),
        ),
        h('div', { class: 'row editor-actions' },
          h('button', { class: 'btn primary', onclick: () => this.save() }, '💾 保存'),
          h('button', { class: 'btn go', onclick: () => this.save(true) }, '保存并试驾 ▶'),
        ),
      ),
    );

    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('dblclick', this.onDbl);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    this.resize();
    this.fit();
    this.setTool(this.tool);
    this.updateInfo();
  }

  // ------------------------------------------------------------------ state
  private pushHistory() {
    this.history.push(JSON.stringify({ p: this.data.points, w: this.data.width }));
    if (this.history.length > 100) this.history.shift();
  }

  private undo() {
    const s = this.history.pop();
    if (!s) return;
    const v = JSON.parse(s);
    this.data.points = v.p;
    this.data.width = v.w;
    this.selected = -1;
    this.changed();
  }

  private changed() {
    this.dirty = true;
    this.render();
    this.updateInfo();
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.toolBtns.draw.classList.toggle('on', t === 'draw');
    this.toolBtns.edit.classList.toggle('on', t === 'edit');
    this.canvas.style.cursor = t === 'draw' ? 'crosshair' : 'default';
    this.render();
  }

  private reverse() {
    if (this.data.points.length < 3) return;
    this.pushHistory();
    const [first, ...rest] = this.data.points;
    this.data.points = [first, ...rest.reverse()];
    this.changed();
  }

  private setStart() {
    if (this.selected < 0) return;
    this.pushHistory();
    const p = this.data.points;
    this.data.points = [...p.slice(this.selected), ...p.slice(0, this.selected)];
    this.selected = 0;
    this.changed();
  }

  private async clearAll() {
    if (this.data.points.length && !(await confirmDialog('清空所有控制点？', '清空'))) return;
    this.pushHistory();
    this.data.points = [];
    this.setTool('draw');
    this.changed();
  }

  private random() {
    this.pushHistory();
    for (let attempt = 0; attempt < 30; attempt++) {
      const n = 9 + Math.floor(Math.random() * 7);
      const R = 180 + Math.random() * 180;
      const radii: number[] = [];
      for (let i = 0; i < n; i++) radii.push(R * (0.45 + Math.random() * 0.6));
      const sm = radii.map((r, i) => (r * 2 + radii[(i + 1) % n] + radii[(i - 1 + n) % n]) / 4);
      const pts = sm.map((r, i) => {
        const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / n) * 0.8;
        return { x: Math.round(Math.cos(a) * r * 1.3), z: Math.round(Math.sin(a) * r) };
      });
      const cand = { ...this.data, points: pts };
      if (!validateTrack(cand).length) {
        this.data.points = pts;
        break;
      }
      if (attempt === 29) this.data.points = pts;
    }
    this.setTool('edit');
    this.changed();
    this.fit();
  }

  private async back() {
    if (this.dirty && !(await confirmDialog('有未保存的修改，确定离开吗？', '离开'))) return;
    toTracks();
  }

  private async save(drive = false) {
    const issues = validateTrack(this.data);
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) {
      toast(errors[0].msg, 'bad', 3000);
      return;
    }
    const warns = issues.filter((i) => i.level === 'warn');
    if (warns.length && !(await confirmDialog(`${warns.map((w) => w.msg).join('；')}。仍然保存吗？`, '保存'))) return;
    saveTrack(this.data);
    this.dirty = false;
    this.isNew = false;
    toast(`赛道「${this.data.name}」已保存`, 'good');
    if (drive) {
      const cars = listCars();
      const car = cars.find((c) => c.id === getPrefs().lastCar) ?? cars[0];
      setPrefs({ lastTrack: this.data.id });
      toRace(this.data, car);
    }
  }

  // ------------------------------------------------------------------ view
  private resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.render();
  }

  private fit() {
    const r = this.wrap.getBoundingClientRect();
    if (this.data.points.length >= 3) {
      this.view = fitView(splinePolyline(this.data.points, 8), r.width, r.height, 80);
    } else {
      this.view = makeView(1.1, r.width / 2, r.height / 2);
    }
    this.render();
  }

  private local(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitPoint(px: number, py: number) {
    let best = -1, bd = 12 * 12;
    this.data.points.forEach((p, i) => {
      const [x, y] = this.view.toScreen(p.x, p.z);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  private hitRoad(px: number, py: number): { seg: number; p: Vec2 } | null {
    const n = this.data.points.length;
    if (n < 3) return null;
    const per = 20;
    const line = splinePolyline(this.data.points, per);
    let best = -1, bd = Infinity;
    line.forEach((p, i) => {
      const [x, y] = this.view.toScreen(p.x, p.z);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    const lim = (this.data.width / 2) * this.view.scale + 8;
    if (Math.sqrt(bd) > lim) return null;
    return { seg: Math.floor(best / per), p: this.view.toWorld(px, py) };
  }

  private onDown = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    const wantsPan = e.button === 1 || this.spaceHeld;
    if (e.button === 2) {
      const hit = this.hitPoint(x, y);
      if (hit >= 0 && this.tool === 'edit') { this.deletePoint(hit); return; }
    }
    if (wantsPan || e.button === 2) {
      this.panFrom = { x, y, ox: this.view.ox, oy: this.view.oy };
      return;
    }
    if (this.tool === 'draw') {
      this.stroke = [this.view.toWorld(x, y)];
      return;
    }
    const hit = this.hitPoint(x, y);
    if (hit >= 0) {
      this.pushHistory();
      this.dragIdx = hit;
      this.selected = hit;
      this.startBtn.disabled = hit === 0;
      this.render();
      return;
    }
    const road = this.hitRoad(x, y);
    if (road) {
      this.pushHistory();
      this.data.points.splice(road.seg + 1, 0, road.p);
      this.dragIdx = road.seg + 1;
      this.selected = this.dragIdx;
      this.startBtn.disabled = false;
      this.changed();
      return;
    }
    this.selected = -1;
    this.startBtn.disabled = true;
    this.panFrom = { x, y, ox: this.view.ox, oy: this.view.oy };
    this.render();
  };

  private onMove = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    if (this.panFrom) {
      this.view = makeView(this.view.scale, this.panFrom.ox + x - this.panFrom.x, this.panFrom.oy + y - this.panFrom.y);
      this.render();
      return;
    }
    if (this.stroke) {
      const w = this.view.toWorld(x, y);
      const last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(w.x - last.x, w.z - last.z) > 2) this.stroke.push(w);
      this.render();
      return;
    }
    if (this.dragIdx >= 0) {
      this.data.points[this.dragIdx] = this.view.toWorld(x, y);
      this.changed();
      return;
    }
    const hov = this.tool === 'edit' ? this.hitPoint(x, y) : -1;
    if (hov !== this.hoverIdx) {
      this.hoverIdx = hov;
      this.canvas.style.cursor = this.tool === 'draw' ? 'crosshair' : hov >= 0 ? 'grab' : this.hitRoad(x, y) ? 'copy' : 'default';
      this.render();
    }
  };

  private onUp = () => {
    if (this.stroke) {
      const s = this.stroke;
      this.stroke = null;
      let len = 0;
      for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
      if (len < 200) {
        toast('画得太短了，至少 200 米', 'bad');
        this.render();
      } else {
        this.pushHistory();
        this.data.points = simplifyStroke(s, this.spacing);
        this.selected = -1;
        this.setTool('edit');
        this.changed();
      }
    }
    this.dragIdx = -1;
    this.panFrom = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { x, y } = this.local(e);
    const w = this.view.toWorld(x, y);
    const s = Math.max(0.08, Math.min(10, this.view.scale * Math.exp(-e.deltaY * 0.0015)));
    this.view = makeView(s, x - w.x * s, y - w.z * s);
    this.render();
  };

  private onDbl = (e: MouseEvent) => {
    if (this.tool !== 'edit') return;
    const { x, y } = this.local(e);
    const hit = this.hitPoint(x, y);
    if (hit >= 0) this.deletePoint(hit);
  };

  private deletePoint(i: number) {
    if (this.data.points.length <= 4) {
      toast('至少保留 4 个控制点', 'bad');
      return;
    }
    this.pushHistory();
    this.data.points.splice(i, 1);
    this.selected = -1;
    this.startBtn.disabled = true;
    this.changed();
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); this.undo(); }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected >= 0) this.deletePoint(this.selected);
    if (e.code === 'Space') { this.spaceHeld = true; e.preventDefault(); }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') this.spaceHeld = false;
  };

  // ------------------------------------------------------------------ drawing
  private render() {
    const c = this.canvas;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / (parseFloat(c.style.width) || c.width);
    const W = c.width / dpr, H = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#8fd765';
    ctx.fillRect(0, 0, W, H);
    // grid
    const v = this.view;
    const steps = [5, 10, 25, 50, 100, 250, 500, 1000];
    const step = steps.find((s) => s * v.scale >= 36) ?? 1000;
    const tl = v.toWorld(0, 0), br = v.toWorld(W, H);
    ctx.lineWidth = 1;
    for (let gx = Math.floor(tl.x / step) * step; gx <= br.x; gx += step) {
      const [x] = v.toScreen(gx, 0);
      ctx.strokeStyle = gx % (step * 5) === 0 ? 'rgba(40,90,30,0.35)' : 'rgba(40,90,30,0.15)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let gz = Math.floor(tl.z / step) * step; gz <= br.z; gz += step) {
      const [, y] = v.toScreen(0, gz);
      ctx.strokeStyle = gz % (step * 5) === 0 ? 'rgba(40,90,30,0.35)' : 'rgba(40,90,30,0.15)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const pts = this.data.points;
    if (pts.length >= 3) {
      // gravel/kerb hint as a wider soft band
      drawTrack(ctx, { ...this.data, width: this.data.width + 6 }, v, { roadColor: 'rgba(255,255,255,0.18)', outline: false, startLine: false });
      drawTrack(ctx, this.data, v, { arrows: true, minWidthPx: 4 });
    }
    // control points
    if (this.tool === 'edit' || pts.length < 3) {
      pts.forEach((p, i) => {
        const [x, y] = v.toScreen(p.x, p.z);
        const r = i === this.hoverIdx || i === this.dragIdx ? 9 : 7;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#43c46b' : i === this.selected ? '#ffd23f' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#1b1d2a';
        ctx.stroke();
        if (i === 0) {
          ctx.fillStyle = '#1b1d2a';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('S', x, y + 0.5);
        }
      });
    }
    // live stroke
    if (this.stroke && this.stroke.length > 1) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(27,29,42,0.5)';
      ctx.lineWidth = Math.max(4, this.data.width * v.scale);
      ctx.beginPath();
      this.stroke.forEach((p, i) => {
        const [x, y] = v.toScreen(p.x, p.z);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
      const [sx, sy] = v.toScreen(this.stroke[0].x, this.stroke[0].z);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!pts.length && !this.stroke) {
      ctx.fillStyle = 'rgba(27,29,42,0.7)';
      ctx.font = 'bold 22px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('按住鼠标，画出一个闭合的圈 ✏️', W / 2, H / 2);
      ctx.font = '15px "Baloo 2", sans-serif';
      ctx.fillText('或点右侧「🎲 随机生成」', W / 2, H / 2 + 28);
    }
    // scale bar
    const barM = steps.find((s) => s * v.scale >= 80) ?? 1000;
    ctx.fillStyle = '#1b1d2a';
    ctx.fillRect(20, H - 30, barM * v.scale, 5);
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${barM} m`, 20, H - 38);
  }

  private updateInfo() {
    const el = this.infoEl;
    el.innerHTML = '';
    if (this.data.points.length < 3) {
      el.append(h('div', { class: 'dim' }, '还没有赛道'));
      return;
    }
    const g = new TrackGeometry(this.data);
    const minR = 1 / Math.max(1e-6, Math.max(...g.samples.map((s) => Math.abs(s.curv))));
    const corners = countCorners(g);
    const issues = validateTrack(this.data);
    el.append(
      h('div', { class: 'stat-row' },
        h('div', null, h('small', null, '长度'), h('b', null, `${(g.length / 1000).toFixed(2)} km`)),
        h('div', null, h('small', null, '弯道'), h('b', null, String(corners))),
        h('div', null, h('small', null, '最小半径'), h('b', null, `${minR.toFixed(0)} m`)),
        h('div', null, h('small', null, '节点'), h('b', null, String(this.data.points.length))),
      ),
      issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', { class: i.level }, i.msg))) : h('div', { class: 'ok' }, '✓ 赛道有效'),
    );
  }

  update() {}

  unmount() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.ro?.disconnect();
  }
}

function countCorners(g: TrackGeometry) {
  let n = 0, inCorner = false;
  for (const s of g.samples) {
    const c = Math.abs(s.curv) > 1 / 90;
    if (c && !inCorner) n++;
    inCorner = c;
  }
  return n;
}
