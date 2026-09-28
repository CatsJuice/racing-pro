import type { Screen } from '../app';
import { ASSIST_LABELS, type AssistLevel } from '../car/physics';
import { peakPower, type CarSetup } from '../car/setup';
import { fetchBoard, identity, type BoardEntry } from '../core/online';
import { deleteLap, fmtTime, getPrefs, getCar, lapsForTrack, listCars, listTracks, saveCar, setPrefs, uid, type LapRecord } from '../core/storage';
import { toMenu, toRace, toReplay } from '../nav';
import { trackThumb } from '../track/draw2d';
import { isOfficial } from '../track/official';
import type { TrackData } from '../track/track';
import { confirmDialog, h, toast } from './dom';
import { playerBadge } from './profile';

/** Row data common to global and local laps. */
interface Row {
  id: string;
  time: number;
  sectors: number[];
  car: CarSetup;
  carName: string;
  assist: AssistLevel;
  rewinds: number;
  topSpeed: number;
  date: number;
  player?: string;
  mine?: boolean;
}

export class LeaderboardScreen implements Screen {
  private track!: TrackData;
  private tracks: TrackData[] = [];
  private side!: HTMLElement;
  private body!: HTMLElement;
  private view: 'global' | 'local' = 'global';
  private token = 0;

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
        h('div', { class: 'dim grow' }, '官方赛道：全球车手同榜竞争 · 本地赛道：只保存在这台设备上'),
        playerBadge(),
      ),
      h('div', { class: 'board-layout' }, h('div', { class: 'panel' }, this.side), h('div', { class: 'panel grow' }, this.body)),
    );
    this.renderSide();
    this.renderBody();
  }

  private renderSide() {
    this.side.innerHTML = '';
    const item = (t: TrackData) =>
      h('div', { class: `board-track ${t.id === this.track.id ? 'on' : ''}`, onclick: () => { this.track = t; this.view = 'global'; this.renderSide(); this.renderBody(); } },
        trackThumb(t, 84, 54),
        h('b', null, t.name),
      );
    const official = this.tracks.filter((t) => isOfficial(t.id));
    const local = this.tracks.filter((t) => !isOfficial(t.id));
    this.side.append(h('div', { class: 'side-title' }, '🌍 官方赛道'), ...official.map(item));
    this.side.append(h('div', { class: 'side-title' }, '💾 本地赛道'), ...(local.length ? local.map(item) : [h('div', { class: 'dim small' }, '还没有自定义赛道')]));
  }

  private async renderBody() {
    const t = this.track;
    const token = ++this.token;
    const official = isOfficial(t.id);
    const global = official && this.view === 'global';
    this.body.innerHTML = '';
    const tabs = official
      ? h('div', { class: 'seg' },
        h('button', { class: `seg-btn ${global ? 'on' : ''}`, onclick: () => { this.view = 'global'; this.renderBody(); } }, '🌍 全球榜'),
        h('button', { class: `seg-btn ${!global ? 'on' : ''}`, onclick: () => { this.view = 'local'; this.renderBody(); } }, '💾 我的本地历史'))
      : h('span', { class: 'tag' }, '本地赛道');
    const head = h('div', { class: 'row between wrap' },
      h('div', { class: 'row' }, h('h2', null, `🏆 ${t.name}`), tabs),
      h('button', { class: 'btn go small', onclick: () => this.drive() }, '去跑一圈 ▶'),
    );
    const status = h('div', { class: 'board-status' }, '加载中…');
    this.body.append(head, status);

    let rows: Row[] = [];
    try {
      if (global) {
        const b = await fetchBoard(t.id, 100);
        if (token !== this.token) return;
        const me = identity()?.id;
        rows = b.entries.map((e) => this.fromEntry(e, me));
        status.innerHTML = '';
        status.append(
          h('span', null, `共 ${b.total} 名车手`),
          b.me ? h('span', { class: 'me-rank' }, `我的最好成绩：全球第 ${b.me.rank} 名 · ${fmtTime(b.me.time)}`) : h('span', { class: 'dim' }, identity() ? '你还没有这条赛道的成绩' : '设置车手名后，你的圈速会上传到这里'),
        );
      } else {
        const laps = await lapsForTrack(t.id);
        if (token !== this.token) return;
        rows = laps.map((l) => this.fromLocal(l));
        status.textContent = official ? '只保存在这台设备上的历史圈速（全球榜只保留每人最好的一圈）' : `本地前 ${rows.length} 圈`;
      }
    } catch (e) {
      if (token !== this.token) return;
      status.innerHTML = '';
      status.append(h('span', { class: 'bad' }, `无法加载全球榜：${(e as Error).message}`), h('button', { class: 'btn small ghost', onclick: () => this.renderBody() }, '重试'));
      return;
    }
    if (!rows.length) {
      this.body.append(h('div', { class: 'empty' }, trackThumb(t, 300, 180), h('p', null, global ? '全球榜还是空的——第一个上榜的就是你！' : '还没有圈速，快去跑一圈吧！')));
      return;
    }
    const best = rows[0].time;
    const bestSec = [0, 1, 2].map((i) => Math.min(...rows.map((r) => r.sectors[i] ?? Infinity)));
    const myRow = rows.find((r) => r.mine);
    const table = h('table', { class: 'board-table' },
      h('thead', null, h('tr', null,
        h('th', null, '#'), global ? h('th', null, '车手') : null, h('th', null, '圈速'), h('th', null, '差距'), h('th', null, '赛车'),
        h('th', null, 'S1'), h('th', null, 'S2'), h('th', null, 'S3'), h('th', null, '极速'), h('th', null, '日期'), h('th', null, ''),
      )),
      h('tbody', null, rows.map((r, i) => this.row(r, i, best, bestSec, rows[0], myRow, global))),
    );
    this.body.append(table);
  }

  private fromEntry(e: BoardEntry, me?: string): Row {
    return {
      id: e.lapId, time: e.time, sectors: e.sectors, car: e.car, carName: e.car.name, assist: e.assist, rewinds: e.rewinds,
      topSpeed: e.topSpeed, date: e.date, player: e.name, mine: !!me && e.userId === me,
    };
  }

  private fromLocal(l: LapRecord): Row {
    return {
      id: l.id, time: l.time, sectors: l.sectors, car: l.car, carName: l.carName, assist: l.assist ?? 'pro', rewinds: l.rewinds ?? 0,
      topSpeed: l.topSpeed, date: l.date,
    };
  }

  private row(r: Row, i: number, best: number, bestSec: number[], leader: Row, mine: Row | undefined, global: boolean) {
    const p = peakPower(r.car);
    const replay = (compare?: string) => toReplay(r.id, compare, global);
    return h('tr', { class: `${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''} ${r.mine ? 'mine' : ''}`, onclick: () => replay() },
      h('td', { class: 'rank' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)),
      global ? h('td', { class: 'player' }, h('b', null, r.player), r.mine ? h('span', { class: 'tag' }, '我') : null) : null,
      h('td', { class: 'mono big' }, fmtTime(r.time)),
      h('td', { class: 'mono dim' }, i === 0 ? '—' : `+${(r.time - best).toFixed(3)}`),
      h('td', null, h('div', { class: 'car-cell' },
        h('span', { class: 'dot', style: { background: `linear-gradient(135deg, ${r.car.color} 55%, ${r.car.accent} 55%)` } }),
        h('div', null, h('b', null, r.carName),
          h('small', { class: 'dim' }, `${r.car.drivetrain} · ${Math.round(p.hp)}hp · ${r.car.mass}kg · 辅助${ASSIST_LABELS[r.assist]}${r.rewinds ? ` · ⏪${r.rewinds}` : ''}`)),
      )),
      ...[0, 1, 2].map((k) => h('td', { class: `mono ${Math.abs((r.sectors[k] ?? 0) - bestSec[k]) < 1e-4 ? 'purple' : ''}` }, (r.sectors[k] ?? 0).toFixed(2))),
      h('td', { class: 'mono' }, `${Math.round(r.topSpeed)}`),
      h('td', { class: 'dim small' }, new Date(r.date).toLocaleDateString()),
      h('td', { class: 'actions', onclick: (e: Event) => e.stopPropagation() },
        h('button', { class: 'btn small', title: '回放', onclick: () => replay() }, '▶ 回放'),
        i > 0 ? h('button', { class: 'btn small ghost', title: '与第一名对比回放', onclick: () => replay((global ? 'o:' : 'l:') + leader.id) }, '⚖ 对比第一') : null,
        global && mine && !r.mine && mine !== leader ? h('button', { class: 'btn small ghost', title: '和我的最好成绩对比', onclick: () => replay('o:' + mine.id) }, '⚖ 对比我') : null,
        global ? h('button', { class: 'btn small ghost', title: '以这圈为幽灵车开跑', onclick: () => this.drive(r.id) }, '👻 挑战') : null,
        h('button', { class: 'btn small ghost', title: '把这圈的调校存入车库', onclick: () => {
          saveCar({ ...r.car, id: uid('car-'), name: `${r.carName}${r.player ? ` · ${r.player}` : ''}`.slice(0, 24), builtin: false });
          toast('调校已存入车库', 'good');
        } }, '🔧 复制调校'),
        !global ? h('button', { class: 'btn small danger', title: '删除', onclick: async () => {
          if (!(await confirmDialog('删除这条本地圈速记录？', '删除'))) return;
          await deleteLap(r.id);
          this.renderBody();
        } }, '✕') : null,
      ),
    );
  }

  private drive(ghostLapId?: string) {
    const car = getCar(getPrefs().lastCar ?? '') ?? listCars()[0];
    setPrefs({ lastTrack: this.track.id });
    toRace(this.track, car, { ghostLapId });
  }

  unmount() {
    this.token++;
  }
}
