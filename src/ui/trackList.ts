import { t, t as t_, trackName } from '../i18n';
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
        h('button', { class: 'btn ghost', onclick: () => toMenu() }, t('common.mainMenu')),
        h('h1', null, t('tracks.title')),
        h('div', { class: 'dim' }, t('tracks.subtitle')),
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
        h('b', null, t('tracks.new')),
        h('small', { class: 'dim' }, t('tracks.newSub')),
      ),
    );
    for (const tr of listTracks()) {
      const geo = new TrackGeometry(tr);
      const best = h('span', { class: 'mono' }, '…');
      bestLap(tr.id).then((l) => (best.textContent = l ? `${fmtTime(l.time)} · ${l.carName}` : t('tracks.noRecord')));
      this.grid.append(
        h('div', { class: 'track-card' },
          trackThumb(tr, 260, 150),
          h('div', { class: 'tc-body' },
            h('div', { class: 'row between' }, h('b', null, trackName(tr)), tr.builtin ? h('span', { class: 'official-tag' }, t('tracks.officialTag')) : h('span', { class: 'tag' }, t('tracks.localTag'))),
            h('small', { class: 'dim' }, t('tracks.meta', { km: (geo.length / 1000).toFixed(2), w: tr.width, n: tr.points.length })),
            h('small', null, '🏆 ', best),
            h('div', { class: 'row wrap tc-actions' },
              h('button', { class: 'btn small', onclick: () => this.edit(tr) }, tr.builtin ? t('tracks.copyEdit') : t('common.edit')),
              !tr.builtin ? h('button', { class: 'btn small ghost', onclick: () => this.copy(tr) }, t('common.copy')) : null,
              h('button', { class: 'btn small ghost', onclick: () => toLeaderboard(tr.id) }, t('tracks.board')),
              h('button', { class: 'btn small go', onclick: () => this.drive(tr) }, t('tracks.drive')),
              !tr.builtin ? h('button', { class: 'btn small danger', onclick: () => this.remove(tr) }, t('common.delete')) : null,
            ),
          ),
        ),
      );
    }
  }

  private edit(t: TrackData) {
    if (t.builtin) {
      const copy: TrackData = { ...t, id: uid('trk-'), name: t_('tracks.modSuffix', { name: trackName(t) }), builtin: false, points: t.points.map((p) => ({ ...p })) };
      toTrackEditor(copy);
    } else toTrackEditor(t);
  }

  private copy(t: TrackData) {
    saveTrack({ ...t, id: uid('trk-'), name: t_('tracks.copySuffix', { name: t.name }), builtin: false, points: t.points.map((p) => ({ ...p })) });
    toast(t_('tracks.copied'), 'good');
    this.render();
  }

  private async remove(t: TrackData) {
    if (!(await confirmDialog(t_('tracks.deleteConfirm', { name: trackName(t) }), t_('common.delete')))) return;
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
