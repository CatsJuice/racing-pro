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
        h('div', { class: 'tagline' }, '画一条赛道 · 调一台赛车 · 刷一个圈速'),
        h('div', { class: 'menu-items' },
          item('🏁', '开始游戏', '选择赛道与赛车，无限计时赛', () => toRaceSetup(), true),
          item('🛣️', '赛道管理', '自己画赛道，编辑与管理', () => toTracks()),
          item('🔧', '赛车管理', '车库 · 调校 50+ 项参数', () => toGarage()),
          item('🏆', '圈速榜', '官方赛道全球排行 · 本地记录 · 回放', () => toLeaderboard()),
        ),
        h('div', { class: 'menu-foot dim' }, `当前赛车：${car.name}`),
      ),
      h('div', { class: 'menu-top-right' }, playerBadge()),
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
