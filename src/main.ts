import './style.css';
import { app } from './app';
import { toMenu } from './nav';
import { loadAssets } from './render/assets';
import { getStage } from './render/toon';
import { h } from './ui/dom';
import { initI18n, t } from './i18n';

async function boot() {
  await initI18n();
  const stage = getStage();
  if (import.meta.env.DEV) (window as any).__rp = { app, stage };
  app.start();
  const bar = h('div', { class: 'boot-fill' });
  const boot = h('div', { class: 'boot' },
    h('div', { class: 'logo' }, h('span', { class: 'l1' }, 'RACING'), h('span', { class: 'l2' }, 'PRO')),
    h('div', { class: 'boot-bar' }, bar),
    h('div', { class: 'dim' }, t('boot.loading')),
  );
  document.body.append(boot);
  try {
    await loadAssets((p) => (bar.style.width = `${Math.round(p * 100)}%`));
  } catch (e) {
    boot.append(h('p', { class: 'bad' }, t('boot.failed', { err: String(e) })));
    return;
  }
  boot.classList.add('out');
  setTimeout(() => boot.remove(), 500);
  await toMenu();
}

boot();
