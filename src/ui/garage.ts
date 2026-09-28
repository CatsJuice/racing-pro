import type { Screen } from '../app';
import { simulatePerformance } from '../car/physics';
import { BUILTIN_CARS, cloneSetup, engineTorqueCurve, gearRatios, PARAM_GROUPS, peakPower, type CarSetup, type ParamMeta } from '../car/setup';
import { deleteCar, getPrefs, listCars, listTracks, saveCar, setPrefs, uid } from '../core/storage';
import { toMenu, toRace } from '../nav';
import { h, confirmDialog, toast } from './dom';
import { Showroom } from './showroom';

export class GarageScreen implements Screen {
  private room!: Showroom;
  private cars: CarSetup[] = [];
  private current!: CarSetup;
  private original = '';
  private listEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private curveCv!: HTMLCanvasElement;
  private tab = 'engine';
  private statsTimer = 0;
  private dirtyEl!: HTMLElement;

  constructor(private initialId?: string) {}

  mount(root: HTMLElement) {
    root.className = 'garage';
    this.room = new Showroom({ interactive: true });
    this.cars = listCars();
    const pick = this.cars.find((c) => c.id === (this.initialId ?? getPrefs().lastCar)) ?? this.cars[0];
    this.listEl = h('div', { class: 'car-list' });
    this.panelEl = h('div', { class: 'tune-panel' });
    this.statsEl = h('div', { class: 'stats-grid' });
    this.curveCv = h('canvas', { class: 'curve' });
    this.dirtyEl = h('span', { class: 'dirty' });
    root.append(
      h('div', { class: 'garage-left panel' },
        h('div', { class: 'row between' }, h('button', { class: 'btn ghost', onclick: () => this.leave(() => toMenu()) }, '← 主菜单'), h('h2', null, '车库')),
        this.listEl,
        h('button', { class: 'btn primary block', onclick: () => this.newCar() }, '＋ 基于当前新建赛车'),
      ),
      h('div', { class: 'garage-right panel' }, this.panelEl),
      h('div', { class: 'garage-bottom panel' },
        h('div', { class: 'stats-wrap' }, this.statsEl),
        h('div', { class: 'curve-wrap' }, h('div', { class: 'curve-title' }, '扭矩 / 功率曲线'), this.curveCv),
      ),
    );
    this.select(pick);
  }

  private get dirty() {
    return JSON.stringify(this.current) !== this.original;
  }

  private async leave(fn: () => void) {
    if (this.dirty && !(await confirmDialog('有未保存的修改，确定离开吗？', '离开'))) return;
    fn();
  }

  private async select(c: CarSetup) {
    if (this.current && this.dirty && c.id !== this.current.id) {
      if (!(await confirmDialog('有未保存的修改，切换会丢失，确定吗？', '切换'))) return;
    }
    this.current = cloneSetup(c);
    this.original = JSON.stringify(this.current);
    setPrefs({ lastCar: c.id });
    this.room.setCar(this.current);
    this.renderList();
    this.renderPanel();
    this.scheduleStats();
  }

  private renderList() {
    this.listEl.innerHTML = '';
    for (const c of this.cars) {
      const p = peakPower(c);
      this.listEl.append(
        h('div', { class: `car-card ${c.id === this.current?.id ? 'on' : ''}`, onclick: () => this.select(c) },
          h('div', { class: 'swatch', style: { background: `linear-gradient(135deg, ${c.color} 60%, ${c.accent} 60%)` } }),
          h('div', { class: 'cc-text' },
            h('b', null, c.name),
            h('small', null, `${c.drivetrain} · ${Math.round(p.hp)} hp · ${c.mass} kg`),
          ),
          c.builtin ? h('span', { class: 'tag' }, '预设') : null,
        ),
      );
    }
  }

  private renderPanel() {
    const c = this.current;
    const el = this.panelEl;
    el.innerHTML = '';
    const tabs = h('div', { class: 'tabs' },
      PARAM_GROUPS.map((g) => h('button', { class: `tab ${g.id === this.tab ? 'on' : ''}`, title: g.label, onclick: () => { this.tab = g.id; this.renderPanel(); } }, h('span', null, g.icon), h('small', null, g.label))),
    );
    const group = PARAM_GROUPS.find((g) => g.id === this.tab)!;
    const fields = h('div', { class: 'fields' }, group.params.map((m) => this.field(m)));
    const tracks = listTracks();
    const trackSel = h('select', { class: 'select' }, tracks.map((t) => h('option', { value: t.id, selected: t.id === getPrefs().lastTrack }, t.name)));
    el.append(
      h('div', { class: 'row between' },
        h('div', null, h('h2', null, c.name, this.dirtyEl), h('div', { class: 'dim small' }, c.builtin ? '预设赛车：保存时会另存为新车' : '自定义赛车')),
      ),
      tabs,
      h('h3', { class: 'group-title' }, `${group.icon} ${group.label}`),
      fields,
      h('div', { class: 'tune-actions' },
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => this.save(false) }, '保存'),
          h('button', { class: 'btn', onclick: () => this.save(true) }, '另存为'),
          h('button', { class: 'btn ghost', onclick: () => this.revert() }, '撤销修改'),
        ),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => this.resetDefaults() }, '恢复预设值'),
          !c.builtin ? h('button', { class: 'btn danger', onclick: () => this.remove() }, '删除') : null,
        ),
        h('div', { class: 'row test-drive' }, trackSel, h('button', { class: 'btn go', onclick: () => {
          const t = tracks.find((x) => x.id === (trackSel as HTMLSelectElement).value) ?? tracks[0];
          setPrefs({ lastTrack: t.id });
          toRace(t, this.current);
        } }, '试驾 ▶')),
      ),
    );
    this.updateDirty();
  }

  private field(m: ParamMeta): HTMLElement {
    const c = this.current as any;
    const key = m.key as string;
    const onChange = () => {
      this.room.updateSetup(this.current);
      if (m.key === 'color' || m.key === 'accent' || m.key === 'name') this.renderList();
      this.updateDirty();
      this.scheduleStats();
    };
    let input: HTMLElement;
    if (m.kind === 'bool') {
      const cb = h('input', { type: 'checkbox', checked: !!c[key], onchange: (e: Event) => { c[key] = (e.target as HTMLInputElement).checked; onChange(); } });
      input = h('label', { class: 'switch' }, cb, h('span', null));
    } else if (m.kind === 'select') {
      input = h('div', { class: 'seg' }, m.options!.map((o) => h('button', {
        class: `seg-btn ${c[key] === o.value ? 'on' : ''}`,
        onclick: (e: Event) => {
          c[key] = o.value;
          (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
          (e.currentTarget as HTMLElement).classList.add('on');
          onChange();
        },
      }, o.label)));
    } else if (m.kind === 'color') {
      input = h('input', { type: 'color', value: c[key], class: 'color', oninput: (e: Event) => { c[key] = (e.target as HTMLInputElement).value; onChange(); } });
    } else if (m.kind === 'text') {
      input = h('input', { type: 'text', value: c[key], class: 'text', maxlength: 24, oninput: (e: Event) => { c[key] = (e.target as HTMLInputElement).value || '未命名'; onChange(); } });
    } else {
      const pct = m.unit === '%' || m.unit === '% 前';
      const fmt = (v: number) => pct ? `${Math.round(v * 100)}` : (m.step ?? 1) < 0.1 ? v.toFixed(2) : (m.step ?? 1) < 1 ? v.toFixed(1) : String(Math.round(v));
      const num = h('input', { type: 'number', class: 'num', value: fmt(c[key]), step: pct ? '1' : String(m.step) });
      const range = h('input', { type: 'range', min: String(m.min), max: String(m.max), step: String(m.step), value: String(c[key]) });
      range.addEventListener('input', () => { c[key] = parseFloat(range.value); num.value = fmt(c[key]); onChange(); });
      num.addEventListener('change', () => {
        let v = parseFloat(num.value);
        if (isNaN(v)) v = c[key];
        if (pct) v /= 100;
        v = Math.max(m.min!, Math.min(m.max!, v));
        c[key] = v;
        range.value = String(v);
        num.value = fmt(v);
        onChange();
      });
      input = h('div', { class: 'range-row' }, range, num, h('span', { class: 'unit' }, pct ? '%' : m.unit ?? ''));
    }
    return h('div', { class: 'field' },
      h('div', { class: 'field-head' }, h('label', null, m.label)),
      input,
      m.desc ? h('div', { class: 'desc' }, m.desc) : null,
    );
  }

  private updateDirty() {
    if (this.dirtyEl) this.dirtyEl.textContent = this.dirty ? ' ●' : '';
  }

  private scheduleStats() {
    clearTimeout(this.statsTimer);
    this.statsEl.classList.add('busy');
    this.drawCurve();
    this.statsTimer = window.setTimeout(() => this.computeStats(), 220);
  }

  private computeStats() {
    const c = this.current;
    const perf = simulatePerformance(c);
    const p = peakPower(c);
    const ratios = gearRatios(c);
    const vmaxGear = ratios.map((r) => (c.redline / 60) * 2 * Math.PI / (r * c.finalDrive) * 0.32 * 3.6);
    const stat = (label: string, value: string, sub = '') => h('div', { class: 'stat' }, h('small', null, label), h('b', null, value), sub ? h('span', { class: 'dim' }, sub) : null);
    this.statsEl.innerHTML = '';
    this.statsEl.classList.remove('busy');
    this.statsEl.append(
      stat('最大功率', `${Math.round(p.hp)} hp`, `@ ${p.rpm} rpm`),
      stat('最大扭矩', `${Math.round(c.maxTorque)} Nm`, `@ ${c.peakTorqueRpm} rpm`),
      stat('功重比', `${Math.round(p.hp / (c.mass / 1000))} hp/t`),
      stat('0-100 km/h', isNaN(perf.zeroTo100) ? '—' : `${perf.zeroTo100.toFixed(2)} s`),
      stat('0-200 km/h', isNaN(perf.zeroTo200) ? '—' : `${perf.zeroTo200.toFixed(2)} s`),
      stat('极速', `${Math.round(perf.topSpeed)} km/h`),
      stat('100-0 刹停', `${perf.brake100.toFixed(1)} m`),
      stat('最大横向', `${perf.lateralG.toFixed(2)} g`),
      h('div', { class: 'stat wide' }, h('small', null, '各挡极速 (红线)'), h('div', { class: 'gears' }, vmaxGear.map((v, i) => h('span', null, h('i', null, i + 1), `${Math.round(v)}`)))),
    );
  }

  private drawCurve() {
    const cv = this.curveCv;
    const w = cv.clientWidth || 300, hgt = cv.clientHeight || 120;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr;
    cv.height = hgt * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const s = this.current;
    const maxP = peakPower(s).kw * 1000;
    const X = (r: number) => 8 + ((r - s.idleRpm) / (s.redline - s.idleRpm)) * (w - 16);
    const plot = (fn: (r: number) => number, max: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let r = s.idleRpm; r <= s.redline; r += 50) {
        const y = hgt - 14 - (fn(r) / max) * (hgt - 26);
        if (r === s.idleRpm) ctx.moveTo(X(r), y);
        else ctx.lineTo(X(r), y);
      }
      ctx.stroke();
    };
    plot((r) => engineTorqueCurve(s, r), s.maxTorque, '#ffd23f');
    plot((r) => engineTorqueCurve(s, r) * r * (2 * Math.PI / 60), maxP, '#ff5d73');
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(`${s.idleRpm}`, 4, hgt - 2);
    ctx.fillText(`${s.redline} rpm`, w - 60, hgt - 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('扭矩', 10, 12);
    ctx.fillStyle = '#ff5d73';
    ctx.fillText('功率', 44, 12);
  }

  private save(asNew: boolean) {
    const c = this.current;
    if (c.builtin || asNew) {
      c.id = uid('car-');
      if (c.builtin || asNew) c.name = asNew && !c.builtin ? `${c.name} 副本` : `${c.name}（改）`;
      c.builtin = false;
    }
    saveCar(c);
    this.cars = listCars();
    this.original = JSON.stringify(c);
    setPrefs({ lastCar: c.id });
    toast(`已保存「${c.name}」到车库`, 'good');
    this.renderList();
    this.renderPanel();
  }

  private revert() {
    this.current = JSON.parse(this.original);
    this.room.updateSetup(this.current);
    this.renderPanel();
    this.scheduleStats();
  }

  private resetDefaults() {
    const base = BUILTIN_CARS.find((b) => b.id === this.current.id) ?? BUILTIN_CARS[0];
    const keep = { id: this.current.id, name: this.current.name, builtin: this.current.builtin, color: this.current.color, accent: this.current.accent };
    this.current = { ...cloneSetup(base), ...keep };
    this.room.updateSetup(this.current);
    this.renderPanel();
    this.scheduleStats();
  }

  private async newCar() {
    const c = cloneSetup(this.current);
    c.id = uid('car-');
    c.name = '我的赛车 ' + (this.cars.filter((x) => !x.builtin).length + 1);
    c.builtin = false;
    saveCar(c);
    this.cars = listCars();
    this.original = JSON.stringify(this.current);
    await this.select(c);
    toast('已创建新赛车', 'good');
  }

  private async remove() {
    if (!(await confirmDialog(`删除赛车「${this.current.name}」？`, '删除'))) return;
    deleteCar(this.current.id);
    this.cars = listCars();
    this.original = JSON.stringify(this.current);
    this.select(this.cars[0]);
  }

  update(dt: number) {
    this.room?.render(dt);
  }

  unmount() {
    clearTimeout(this.statsTimer);
    this.room?.dispose();
  }
}
