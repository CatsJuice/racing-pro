import type { Screen } from '../app';
import { type AssistLevel } from '../car/physics';
import { fmtDate, t, trackName, tx } from '../i18n';
import { peakPower, type CarSetup } from '../car/setup';
import { fetchBoard, identity, type BoardEntry } from '../core/online';
import { deleteLap, fmtTime, getPrefs, getCar, lapsForTrack, listCars, listTracks, saveCar, setPrefs, uid, type LapRecord } from '../core/storage';
import { toMenu, toRace, toReplay } from '../nav';
import { trackThumb } from '../track/draw2d';
import { isOfficial } from '../track/official';
import type { TrackData } from '../track/track';
import { confirmDialog, h, toast } from './dom';
import { playerBadge } from './profile';
import { icon, plain } from './icons';

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
        h('button', { class: 'btn ghost', onclick: () => toMenu() }, icon('back', 16), plain(t('common.mainMenu'))),
        h('h1', null, t('board.title')),
        h('div', { class: 'dim grow' }, t('board.subtitle')),
        playerBadge(),
      ),
      h('div', { class: 'board-layout' }, h('div', { class: 'panel' }, this.side), h('div', { class: 'panel grow' }, this.body)),
    );
    this.renderSide();
    this.renderBody();
  }

  private renderSide() {
    this.side.innerHTML = '';
    const item = (tr: TrackData) =>
      h('div', { class: `board-track ${tr.id === this.track.id ? 'on' : ''}`, onclick: () => { this.track = tr; this.view = 'global'; this.renderSide(); this.renderBody(); } },
        trackThumb(tr, 84, 54),
        h('b', null, trackName(tr)),
      );
    const official = this.tracks.filter((tr) => isOfficial(tr.id));
    const local = this.tracks.filter((tr) => !isOfficial(tr.id));
    this.side.append(h('div', { class: 'side-title' }, icon('globe', 13), plain(t('board.official'))), ...official.map(item));
    this.side.append(h('div', { class: 'side-title' }, icon('save', 13), plain(t('board.local'))), ...(local.length ? local.map(item) : [h('div', { class: 'dim small' }, t('board.noLocalTracks'))]));
  }

  private async renderBody() {
    const tr = this.track;
    const token = ++this.token;
    const official = isOfficial(tr.id);
    const global = official && this.view === 'global';
    this.body.innerHTML = '';
    const tabs = official
      ? h('div', { class: 'seg' },
        h('button', { class: `seg-btn ${global ? 'on' : ''}`, onclick: () => { this.view = 'global'; this.renderBody(); } }, icon('globe', 14), plain(t('board.global'))),
        h('button', { class: `seg-btn ${!global ? 'on' : ''}`, onclick: () => { this.view = 'local'; this.renderBody(); } }, icon('clock', 14), plain(t('board.myHistory'))))
      : h('span', { class: 'tag' }, t('board.localTag'));
    const head = h('div', { class: 'row between wrap' },
      h('div', { class: 'row', style: { gap: '14px' } }, h('h2', null, icon('trophy', 22), trackName(tr)), tabs),
      h('button', { class: 'btn go', onclick: () => this.drive() }, icon('play', 13), plain(t('board.drive'))),
    );
    const status = h('div', { class: 'board-status' }, t('common.loading'));
    this.body.append(head, status);

    let rows: Row[] = [];
    try {
      if (global) {
        const b = await fetchBoard(tr.id, 100);
        if (token !== this.token) return;
        const me = identity()?.id;
        rows = b.entries.map((e) => this.fromEntry(e, me));
        status.innerHTML = '';
        status.append(
          h('span', null, t('board.drivers', { n: b.total })),
          b.me ? h('span', { class: 'me-rank' }, t('board.myBest', { rank: b.me.rank, time: fmtTime(b.me.time) })) : h('span', { class: 'dim' }, identity() ? t('board.noMine') : t('board.needName')),
        );
      } else {
        const laps = await lapsForTrack(tr.id);
        if (token !== this.token) return;
        rows = laps.map((l) => this.fromLocal(l));
        status.textContent = official ? t('board.historyNote') : t('board.localTop', { n: rows.length });
      }
    } catch (e) {
      if (token !== this.token) return;
      status.innerHTML = '';
      status.append(h('span', { class: 'bad' }, t('board.loadFail', { err: (e as Error).message })), h('button', { class: 'btn small ghost', onclick: () => this.renderBody() }, t('common.retry')));
      return;
    }
    if (!rows.length) {
      this.body.append(h('div', { class: 'empty' }, trackThumb(tr, 300, 180), h('p', null, global ? t('board.emptyGlobal') : t('board.empty'))));
      return;
    }
    const best = rows[0].time;
    const bestSec = [0, 1, 2].map((i) => Math.min(...rows.map((r) => r.sectors[i] ?? Infinity)));
    const myRow = rows.find((r) => r.mine);
    const table = h('table', { class: 'board-table' },
      h('thead', null, h('tr', null,
        h('th', null, '#'), global ? h('th', null, t('board.driver')) : null, h('th', null, t('board.lapTime')), h('th', null, t('board.gap')), h('th', null, t('board.car')),
        h('th', null, 'S1'), h('th', null, 'S2'), h('th', null, 'S3'), h('th', null, t('board.topSpeed')), h('th', null, t('board.date')), h('th', null, ''),
      )),
      h('tbody', null, rows.map((r, i) => this.row(r, i, best, bestSec, rows[0], myRow, global))),
    );
    this.body.append(table);
  }

  private fromEntry(e: BoardEntry, me?: string): Row {
    return {
      id: e.lapId, time: e.time, sectors: e.sectors, car: e.car, carName: tx(`car.${e.car.id}`, e.car.name), assist: e.assist, rewinds: e.rewinds,
      topSpeed: e.topSpeed, date: e.date, player: e.name, mine: !!me && e.userId === me,
    };
  }

  private fromLocal(l: LapRecord): Row {
    return {
      id: l.id, time: l.time, sectors: l.sectors, car: l.car, carName: tx(`car.${l.carId}`, l.carName), assist: l.assist ?? 'pro', rewinds: l.rewinds ?? 0,
      topSpeed: l.topSpeed, date: l.date,
    };
  }

  private row(r: Row, i: number, best: number, bestSec: number[], leader: Row, mine: Row | undefined, global: boolean) {
    const p = peakPower(r.car);
    const replay = (compare?: string) => toReplay(r.id, compare, global);
    return h('tr', { class: `${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''} ${r.mine ? 'mine' : ''}`, onclick: () => replay() },
      h('td', { class: 'rank' }, i < 3 ? h('span', { class: `rank-medal m${i + 1}` }, String(i + 1)) : String(i + 1)),
      global ? h('td', { class: 'player' }, h('b', null, r.player), r.mine ? h('span', { class: 'tag' }, t('common.me')) : null) : null,
      h('td', { class: 'mono big' }, fmtTime(r.time)),
      h('td', { class: 'mono dim' }, i === 0 ? '—' : `+${(r.time - best).toFixed(3)}`),
      h('td', null, h('div', { class: 'car-cell' },
        h('span', { class: 'dot', style: { background: `linear-gradient(135deg, ${r.car.color} 55%, ${r.car.accent} 55%)` } }),
        h('div', null, h('b', null, r.carName),
          h('small', { class: 'dim' }, `${r.car.drivetrain} · ${Math.round(p.hp)}hp · ${r.car.mass}kg · ${t('board.assist', { a: t(`assist.${r.assist}`) })}${r.rewinds ? ` · ⏪${r.rewinds}` : ''}`)),
      )),
      ...[0, 1, 2].map((k) => h('td', { class: `mono ${Math.abs((r.sectors[k] ?? 0) - bestSec[k]) < 1e-4 ? 'purple' : ''}` }, (r.sectors[k] ?? 0).toFixed(2))),
      h('td', { class: 'mono' }, `${Math.round(r.topSpeed)}`),
      h('td', { class: 'dim small' }, fmtDate(r.date)),
      h('td', { class: 'actions', onclick: (e: Event) => e.stopPropagation() },
        h('button', { class: 'btn small', title: plain(t('board.replay')), onclick: () => replay() }, icon('play', 12), plain(t('board.replay'))),
        i > 0 ? h('button', { class: 'btn small ghost icon', title: t('board.cmpLeaderT'), onclick: () => replay((global ? 'o:' : 'l:') + leader.id) }, icon('compare', 15)) : null,
        global && mine && !r.mine && mine !== leader ? h('button', { class: 'btn small ghost icon', title: t('board.cmpMeT'), onclick: () => replay('o:' + mine.id) }, icon('user', 15)) : null,
        global ? h('button', { class: 'btn small ghost icon', title: t('board.challengeT'), onclick: () => this.drive(r.id) }, icon('ghost', 15)) : null,
        h('button', { class: 'btn small ghost icon', title: t('board.copyTuneT'), onclick: () => {
          saveCar({ ...r.car, id: uid('car-'), name: `${r.carName}${r.player ? ` · ${r.player}` : ''}`.slice(0, 24), builtin: false });
          toast(t('board.tuneCopied'), 'good');
        } }, icon('sliders', 15)),
        !global ? h('button', { class: 'btn small ghost icon', title: t('common.delete'), onclick: async () => {
          if (!(await confirmDialog(t('board.deleteConfirm'), t('common.delete')))) return;
          await deleteLap(r.id);
          this.renderBody();
        } }, icon('trash', 15)) : null,
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
