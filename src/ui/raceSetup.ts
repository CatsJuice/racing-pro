import type { Screen } from '../app';
import { ASSIST_LEVELS, type AssistLevel } from '../car/physics';
import { carName, t, trackName } from '../i18n';
import { peakPower, type CarSetup } from '../car/setup';
import { bestLap, fmtTime, getPrefs, listCars, listTracks, setPrefs } from '../core/storage';
import { toGarage, toMenu, toRace, toTrackEditor } from '../nav';
import { trackThumb } from '../track/draw2d';
import { TrackGeometry, type TrackData } from '../track/track';
import { fetchBoard } from '../core/online';
import { isOfficial } from '../track/official';
import { h } from './dom';
import { timeControls } from './timeControls';
import { playerBadge } from './profile';

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
        h('button', { class: 'btn ghost', onclick: () => toMenu() }, t('common.mainMenu')),
        h('h1', null, t('setup.title')),
        h('div', { class: 'dim grow' }, t('setup.subtitle')),
        playerBadge(),
      ),
      h('div', { class: 'setup-body' },
        h('section', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', null, t('setup.pickTrack')), h('button', { class: 'btn small ghost', onclick: () => toTrackEditor() }, t('setup.newTrack'))), this.trackGrid),
        h('section', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', null, t('setup.pickCar')), h('button', { class: 'btn small ghost', onclick: () => toGarage(this.car.id) }, t('setup.tune'))), this.carList),
      ),
      h('div', { class: 'setup-foot panel' }, this.summary, this.assistPicker(), h('div', { class: 'setup-time' }, timeControls()), h('button', { class: 'btn go huge', onclick: () => this.start() }, t('setup.go'))),
    );
    this.renderTracks(tracks);
    this.renderCars(cars);
    this.renderSummary();
  }

  private renderTracks(tracks: TrackData[]) {
    this.trackGrid.innerHTML = '';
    const official = tracks.filter((t) => isOfficial(t.id));
    const local = tracks.filter((t) => !isOfficial(t.id));
    const sections: [string, TrackData[]][] = [[t('setup.official'), official], [t('setup.local'), local]];
    for (const [title, list] of sections) {
      if (!list.length) continue;
      const grid = h('div', { class: 'track-grid' });
      this.trackGrid.append(h('div', { class: 'track-section' }, h('h3', null, title), grid));
      for (const tr of list) this.trackCard(tr, tracks, grid);
    }
  }

  private trackCard(tr: TrackData, tracks: TrackData[], grid: HTMLElement) {
    {
      const geo = new TrackGeometry(tr);
      const best = h('span', { class: 'mono' }, '…');
      const record = isOfficial(tr.id) ? h('small', null, '🌍 ', h('span', { class: 'mono' }, '…')) : null;
      bestLap(tr.id).then((l) => (best.textContent = l ? fmtTime(l.time) : t('setup.noTime')));
      if (record) fetchBoard(tr.id, 1).then((b) => {
        record.lastChild!.textContent = b.entries[0] ? `${fmtTime(b.entries[0].time)} · ${b.entries[0].name}` : t('setup.noRecord');
      }).catch(() => (record.lastChild!.textContent = t('common.offline')));
      grid.append(
        h('div', { class: `track-card ${tr.id === this.track.id ? 'on' : ''}`, onclick: () => { this.track = tr; this.renderTracks(tracks); this.renderSummary(); } },
          trackThumb(tr, 200, 120),
          h('div', { class: 'tc-body' },
            h('b', null, trackName(tr)),
            h('small', { class: 'dim' }, `${(geo.length / 1000).toFixed(2)} km · ${t('setup.width', { w: tr.width })}`),
            h('small', null, t('setup.myBest'), best),
            record,
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
          h('div', { class: 'cc-text' }, h('b', null, carName(c)), h('small', null, `${c.drivetrain} · ${Math.round(p.hp)} hp · ${c.mass} kg · ${t('setup.downforce', { v: (c.downforceF + c.downforceR).toFixed(1) })}`)),
          c.builtin ? h('span', { class: 'tag' }, t('common.preset')) : null,
        ),
      );
    }
  }

  private assistPicker() {
    const cur = getPrefs().assist ?? 'novice';
    const desc = (l: AssistLevel) => t(`assist.${l}Desc`);
    const tip = h('small', { class: 'dim assist-tip' }, desc(cur));
    const seg = h('div', { class: 'seg' }, ASSIST_LEVELS.map((l) => h('button', {
      class: `seg-btn ${l === cur ? 'on' : ''}`,
      onclick: (e: Event) => {
        setPrefs({ assist: l });
        seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
        (e.currentTarget as HTMLElement).classList.add('on');
        tip.textContent = desc(l);
      },
    }, t(`assist.${l}`))));
    return h('div', { class: 'assist-pick' }, h('div', { class: 'row' }, h('b', null, t('assist.title')), seg), tip);
  }

  private renderSummary() {
    this.summary.innerHTML = '';
    this.summary.append(h('span', null, '🛣️ ', h('b', null, trackName(this.track))), h('span', null, '  ·  🚗 ', h('b', null, carName(this.car))));
  }

  private start() {
    setPrefs({ lastTrack: this.track.id, lastCar: this.car.id });
    toRace(this.track, this.car);
  }

  unmount() {}
}
