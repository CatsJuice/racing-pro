import { carName, t } from '../i18n';
import { langPicker } from './langPicker';
import type { Screen } from '../app';
import { getCar, getPrefs, listCars } from '../core/storage';
import { toGarage, toLeaderboard, toRaceSetup, toTracks } from '../nav';
import { identity } from '../core/online';
import { h } from './dom';
import { nameDialog, playerBadge } from './profile';

let promptedThisSession = false;
import { Showroom } from './showroom';

export class MenuScreen implements Screen {
  private room!: Showroom;

  mount(root: HTMLElement) {
    this.room = new Showroom();
    this.room.offsetX = 0.16;
    const car = getCar(getPrefs().lastCar ?? '') ?? listCars()[0];
    this.room.setCar(car);
    root.className = 'menu';
    const item = (icon: string, label: string, sub: string, fn: () => void, primary = false) =>
      h('button', { class: `menu-item ${primary ? 'primary' : ''}`, onclick: fn },
        h('span', { class: 'mi-icon' }, icon),
        h('span', { class: 'mi-text' }, h('b', null, label), h('small', null, sub)),
      );
    root.append(
      h('div', { class: 'menu-left' },
        h('div', { class: 'logo' }, h('span', { class: 'l1' }, 'RACING'), h('span', { class: 'l2' }, 'PRO')),
        h('div', { class: 'tagline' }, t('menu.tagline')),
        h('div', { class: 'menu-items' },
          item('🏁', t('menu.start'), t('menu.startSub'), () => toRaceSetup(), true),
          item('🛣️', t('menu.tracks'), t('menu.tracksSub'), () => toTracks()),
          item('🔧', t('menu.garage'), t('menu.garageSub'), () => toGarage()),
          item('🏆', t('menu.board'), t('menu.boardSub'), () => toLeaderboard()),
        ),
        h('div', { class: 'menu-foot dim' }, t('menu.currentCar', { car: carName(car) })),
      ),
      h('div', { class: 'menu-top-right row' }, langPicker(), playerBadge()),
    );
    if (!identity() && !promptedThisSession) {
      promptedThisSession = true;
      setTimeout(() => nameDialog({ first: true }), 400);
    }
  }

  update(dt: number) {
    this.room?.render(dt);
  }

  unmount() {
    this.room?.dispose();
  }
}
