import type { Screen } from '../app';
import { ASSIST_LABELS, type AssistLevel } from '../car/physics';
import { peakPower, type CarSetup } from '../car/setup';
import { bestLap, fmtTime, getPrefs, listCars, listTracks, setPrefs } from '../core/storage';
import { toGarage, toMenu, toRace, toTrackEditor } from '../nav';
import { trackThumb } from '../track/draw2d';
import { TrackGeometry, type TrackData } from '../track/track';
import { h } from './dom';

export class RaceSetupScreen implements Screen {
  private track!: TrackData;
  private car!: CarSetup;
  private trackGrid!: HTMLElement;
  private carList!: HTMLElement;
  private summary!: HTMLElement;

  mount(root: HTMLElement) {
    root.className = 'screen setup';
    const tracks = listTracks();
    const cars = listCars();
    const prefs = getPrefs();
    this.track = tracks.find((t) => t.id === prefs.lastTrack) ?? tracks[0];
    this.car = cars.find((c) => c.id === prefs.lastCar) ?? cars[0];
    this.trackGrid = h('div', { class: 'track-grid' });
    this.carList = h('div', { class: 'car-list big' });
    this.summary = h('div', { class: 'setup-summary' });
    root.append(
      h('div', { class: 'screen-head' },
        h('button', { class: 'btn ghost', onclick: () => toMenu() }, '← 主菜单'),
        h('h1', null, '开始游戏'),
        h('div', { class: 'dim' }, '无限计时赛：越过起跑线开始计时，每一圈都会记录圈速'),
      ),
      h('div', { class: 'setup-body' },
        h('section', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', null, '① 选择赛道'), h('button', { class: 'btn small ghost', onclick: () => toTrackEditor() }, '＋ 画新赛道')), this.trackGrid),
        h('section', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', null, '② 选择赛车'), h('button', { class: 'btn small ghost', onclick: () => toGarage(this.car.id) }, '调校 →')), this.carList),
      ),
      h('div', { class: 'setup-foot panel' }, this.summary, this.assistPicker(), h('button', { class: 'btn go huge', onclick: () => this.start() }, '出发 ▶')),
    );
    this.renderTracks(tracks);
    this.renderCars(cars);
    this.renderSummary();
  }

  private renderTracks(tracks: TrackData[]) {
    this.trackGrid.innerHTML = '';
    for (const t of tracks) {
      const geo = new TrackGeometry(t);
      const best = h('span', { class: 'mono' }, '…');
      bestLap(t.id).then((l) => (best.textContent = l ? fmtTime(l.time) : '暂无'));
      this.trackGrid.append(
        h('div', { class: `track-card ${t.id === this.track.id ? 'on' : ''}`, onclick: () => { this.track = t; this.renderTracks(tracks); this.renderSummary(); } },
          trackThumb(t, 200, 120),
          h('div', { class: 'tc-body' },
            h('b', null, t.name),
            h('small', { class: 'dim' }, `${(geo.length / 1000).toFixed(2)} km · 宽 ${t.width} m`),
            h('small', null, '🏆 ', best),
          ),
        ),
      );
    }
  }

  private renderCars(cars: CarSetup[]) {
    this.carList.innerHTML = '';
    for (const c of cars) {
      const p = peakPower(c);
      this.carList.append(
        h('div', { class: `car-card ${c.id === this.car.id ? 'on' : ''}`, onclick: () => { this.car = c; this.renderCars(cars); this.renderSummary(); } },
          h('div', { class: 'swatch', style: { background: `linear-gradient(135deg, ${c.color} 60%, ${c.accent} 60%)` } }),
          h('div', { class: 'cc-text' }, h('b', null, c.name), h('small', null, `${c.drivetrain} · ${Math.round(p.hp)} hp · ${c.mass} kg · 下压 ${(c.downforceF + c.downforceR).toFixed(1)}`)),
          c.builtin ? h('span', { class: 'tag' }, '预设') : null,
        ),
      );
    }
  }

  private assistPicker() {
    const cur = getPrefs().assist ?? 'novice';
    const desc: Record<AssistLevel, string> = {
      novice: '转向限幅 + 自动反打 + 强稳定 + TCS/ABS，键盘也能轻松跑完',
      standard: '保留转向限幅与适度稳定辅助，需要自己控油门',
      pro: '无任何辅助，完全由赛车调校决定手感（推荐手柄）',
    };
    const tip = h('small', { class: 'dim assist-tip' }, desc[cur]);
    const seg = h('div', { class: 'seg' }, (['novice', 'standard', 'pro'] as AssistLevel[]).map((l) => h('button', {
      class: `seg-btn ${l === cur ? 'on' : ''}`,
      onclick: (e: Event) => {
        setPrefs({ assist: l });
        seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
        (e.currentTarget as HTMLElement).classList.add('on');
        tip.textContent = desc[l];
      },
    }, ASSIST_LABELS[l])));
    return h('div', { class: 'assist-pick' }, h('div', { class: 'row' }, h('b', null, '驾驶辅助'), seg), tip);
  }

  private renderSummary() {
    this.summary.innerHTML = '';
    this.summary.append(h('span', null, '🛣️ ', h('b', null, this.track.name)), h('span', null, '  ·  🚗 ', h('b', null, this.car.name)));
  }

  private start() {
    setPrefs({ lastTrack: this.track.id, lastCar: this.car.id });
    toRace(this.track, this.car);
  }

  unmount() {}
}
