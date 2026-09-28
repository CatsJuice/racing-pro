import type { Screen } from '../app';
import { bestLap, deleteTrack, fmtTime, getPrefs, listCars, listTracks, saveTrack, setPrefs, uid } from '../core/storage';
import { toLeaderboard, toMenu, toRace, toTrackEditor } from '../nav';
import { trackThumb } from '../track/draw2d';
import { TrackGeometry, type TrackData } from '../track/track';
import { confirmDialog, h, toast } from './dom';

export class TrackListScreen implements Screen {
  private grid!: HTMLElement;

  mount(root: HTMLElement) {
    root.className = 'screen tracks';
    this.grid = h('div', { class: 'track-grid large' });
    root.append(
      h('div', { class: 'screen-head' },
        h('button', { class: 'btn ghost', onclick: () => toMenu() }, '← 主菜单'),
        h('h1', null, '赛道管理'),
        h('div', { class: 'dim' }, '官方赛道有全球圈速榜，可复制为本地赛道后修改；自己画的赛道保存在本地，随时编辑'),
      ),
      h('div', { class: 'panel' }, this.grid),
    );
    this.render();
  }

  private render() {
    this.grid.innerHTML = '';
    this.grid.append(
      h('div', { class: 'track-card new', onclick: () => toTrackEditor() },
        h('div', { class: 'plus' }, '＋'),
        h('b', null, '画一条新赛道'),
        h('small', { class: 'dim' }, '自由手绘或逐点编辑'),
      ),
    );
    for (const t of listTracks()) {
      const geo = new TrackGeometry(t);
      const best = h('span', { class: 'mono' }, '…');
      bestLap(t.id).then((l) => (best.textContent = l ? `${fmtTime(l.time)} · ${l.carName}` : '暂无记录'));
      this.grid.append(
        h('div', { class: 'track-card' },
          trackThumb(t, 260, 150),
          h('div', { class: 'tc-body' },
            h('div', { class: 'row between' }, h('b', null, t.name), t.builtin ? h('span', { class: 'official-tag' }, '官方 · 全球榜') : h('span', { class: 'tag' }, '本地')),
            h('small', { class: 'dim' }, `${(geo.length / 1000).toFixed(2)} km · 宽 ${t.width} m · ${t.points.length} 控制点`),
            h('small', null, '🏆 ', best),
            h('div', { class: 'row wrap tc-actions' },
              h('button', { class: 'btn small', onclick: () => this.edit(t) }, t.builtin ? '复制并编辑' : '编辑'),
              !t.builtin ? h('button', { class: 'btn small ghost', onclick: () => this.copy(t) }, '复制') : null,
              h('button', { class: 'btn small ghost', onclick: () => toLeaderboard(t.id) }, '圈速榜'),
              h('button', { class: 'btn small go', onclick: () => this.drive(t) }, '开跑 ▶'),
              !t.builtin ? h('button', { class: 'btn small danger', onclick: () => this.remove(t) }, '删除') : null,
            ),
          ),
        ),
      );
    }
  }

  private edit(t: TrackData) {
    if (t.builtin) {
      const copy: TrackData = { ...t, id: uid('trk-'), name: `${t.name}（改）`, builtin: false, points: t.points.map((p) => ({ ...p })) };
      toTrackEditor(copy);
    } else toTrackEditor(t);
  }

  private copy(t: TrackData) {
    saveTrack({ ...t, id: uid('trk-'), name: `${t.name} 副本`, builtin: false, points: t.points.map((p) => ({ ...p })) });
    toast('已复制', 'good');
    this.render();
  }

  private async remove(t: TrackData) {
    if (!(await confirmDialog(`删除赛道「${t.name}」？该赛道的圈速记录也会被删除。`, '删除'))) return;
    deleteTrack(t.id);
    this.render();
  }

  private drive(t: TrackData) {
    const cars = listCars();
    const car = cars.find((c) => c.id === getPrefs().lastCar) ?? cars[0];
    setPrefs({ lastTrack: t.id });
    toRace(t, car);
  }

  unmount() {}
}
