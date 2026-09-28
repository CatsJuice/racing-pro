import type { Screen } from '../app';
import { ASSIST_LABELS } from '../car/physics';
import { peakPower } from '../car/setup';
import { deleteLap, fmtTime, getPrefs, lapsForTrack, listTracks, saveCar, uid, type LapRecord } from '../core/storage';
import { toMenu, toRace, toReplay } from '../nav';
import { trackThumb } from '../track/draw2d';
import type { TrackData } from '../track/track';
import { confirmDialog, h, toast } from './dom';

export class LeaderboardScreen implements Screen {
  private track!: TrackData;
  private tracks: TrackData[] = [];
  private side!: HTMLElement;
  private body!: HTMLElement;

  constructor(private trackId?: string) {}

  mount(root: HTMLElement) {
    root.className = 'screen board';
    this.tracks = listTracks();
    this.track = this.tracks.find((t) => t.id === (this.trackId ?? getPrefs().lastTrack)) ?? this.tracks[0];
    this.side = h('div', { class: 'board-tracks' });
    this.body = h('div', { class: 'board-body' });
    root.append(
      h('div', { class: 'screen-head' },
        h('button', { class: 'btn ghost', onclick: () => toMenu() }, '← 主菜单'),
        h('h1', null, '圈速榜'),
        h('div', { class: 'dim' }, '点击任意一行即可回放该圈：俯视视角 + 速度着色走线 + 刹车点标注'),
      ),
      h('div', { class: 'board-layout' }, h('div', { class: 'panel' }, this.side), h('div', { class: 'panel grow' }, this.body)),
    );
    this.renderSide();
    this.renderBody();
  }

  private renderSide() {
    this.side.innerHTML = '';
    for (const t of this.tracks) {
      this.side.append(
        h('div', { class: `board-track ${t.id === this.track.id ? 'on' : ''}`, onclick: () => { this.track = t; this.renderSide(); this.renderBody(); } },
          trackThumb(t, 84, 54),
          h('b', null, t.name),
        ),
      );
    }
  }

  private async renderBody() {
    const t = this.track;
    this.body.innerHTML = '';
    this.body.append(h('div', { class: 'loading-inline' }, '加载中…'));
    const laps = await lapsForTrack(t.id);
    this.body.innerHTML = '';
    this.body.append(
      h('div', { class: 'row between' },
        h('h2', null, `🏆 ${t.name}`),
        h('button', { class: 'btn go small', onclick: () => {
          const car = laps[0]?.car;
          if (car) toRace(t, car); else toMenu();
        } }, laps.length ? '用冠军赛车挑战 ▶' : '去跑一圈 ▶'),
      ),
    );
    if (!laps.length) {
      this.body.append(h('div', { class: 'empty' }, trackThumb(t, 300, 180), h('p', null, '这条赛道还没有有效圈速，快去跑一圈吧！')));
      return;
    }
    const best = laps[0].time;
    const bestSec = [0, 1, 2].map((i) => Math.min(...laps.map((l) => l.sectors[i] ?? Infinity)));
    const table = h('table', { class: 'board-table' },
      h('thead', null, h('tr', null,
        h('th', null, '#'), h('th', null, '圈速'), h('th', null, '差距'), h('th', null, '赛车'),
        h('th', null, 'S1'), h('th', null, 'S2'), h('th', null, 'S3'), h('th', null, '极速'), h('th', null, '日期'), h('th', null, ''),
      )),
      h('tbody', null, laps.map((l, i) => this.row(l, i, best, bestSec, laps[0]))),
    );
    this.body.append(table);
  }

  private row(l: LapRecord, i: number, best: number, bestSec: number[], leader: LapRecord) {
    const p = peakPower(l.car);
    return h('tr', { class: i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '', onclick: () => toReplay(l.id) },
      h('td', { class: 'rank' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
      h('td', { class: 'mono big' }, fmtTime(l.time)),
      h('td', { class: 'mono dim' }, i === 0 ? '—' : `+${(l.time - best).toFixed(3)}`),
      h('td', null, h('div', { class: 'car-cell' },
        h('span', { class: 'dot', style: { background: l.car.color } }),
        h('div', null, h('b', null, l.carName), h('small', { class: 'dim' }, `${l.car.drivetrain} · ${Math.round(p.hp)}hp · ${l.car.mass}kg · 辅助${ASSIST_LABELS[l.assist ?? 'pro']}${l.rewinds ? ` · ⏪${l.rewinds}` : ''}`)),
      )),
      ...[0, 1, 2].map((k) => h('td', { class: `mono ${Math.abs((l.sectors[k] ?? 0) - bestSec[k]) < 1e-4 ? 'purple' : ''}` }, (l.sectors[k] ?? 0).toFixed(2))),
      h('td', { class: 'mono' }, `${Math.round(l.topSpeed)}`),
      h('td', { class: 'dim small' }, new Date(l.date).toLocaleDateString()),
      h('td', { class: 'actions', onclick: (e: Event) => e.stopPropagation() },
        h('button', { class: 'btn small', title: '回放', onclick: () => toReplay(l.id) }, '▶ 回放'),
        i > 0 ? h('button', { class: 'btn small ghost', title: '与第一名对比回放', onclick: () => toReplay(l.id, leader.id) }, '⚖ 对比第一') : null,
        h('button', { class: 'btn small ghost', title: '把这圈的调校存入车库', onclick: () => {
          saveCar({ ...l.car, id: uid('car-'), name: `${l.carName} @${fmtTime(l.time)}`, builtin: false });
          toast('调校已存入车库', 'good');
        } }, '🔧 复制调校'),
        h('button', { class: 'btn small danger', title: '删除', onclick: async () => {
          if (!(await confirmDialog('删除这条圈速记录？', '删除'))) return;
          await deleteLap(l.id);
          this.renderBody();
        } }, '✕'),
      ),
    );
  }

  unmount() {}
}
