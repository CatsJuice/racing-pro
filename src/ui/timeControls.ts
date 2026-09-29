import { t } from '../i18n';
import { getPrefs, setPrefs } from '../core/storage';
import { hourLabel, TIME_PRESETS, type Environment } from '../render/environment';
import { getStage } from '../render/toon';
import { h } from './dom';

const FLOWS: { key: 'time.flowOff' | 'time.flowSlow' | 'time.flowFast'; v: number }[] = [
  { key: 'time.flowOff', v: 0 },
  { key: 'time.flowSlow', v: 1 / 60 },
  { key: 'time.flowFast', v: 1 / 10 },
];

/**
 * Time-of-day controls. With an Environment they act live; without one they only edit prefs
 * (used before a race starts).
 */
export function timeControls(env?: Environment): HTMLElement {
  const prefs = getPrefs();
  let hour = env?.hour ?? prefs.hour ?? 16.8;
  const label = h('b', { class: 'mono' }, hourLabel(hour));
  const icon = h('span', { class: 'time-icon' });
  const slider = h('input', { type: 'range', min: '0', max: '24', step: '0.05', value: String(hour) });
  const setHour = (v: number) => {
    hour = ((v % 24) + 24) % 24;
    slider.value = String(hour);
    label.textContent = hourLabel(hour);
    icon.textContent = hour >= 6 && hour < 18.5 ? (hour < 7.5 || hour > 17 ? '🌅' : '☀️') : '🌙';
    env?.setHour(hour);
    setPrefs({ hour });
  };
  setHour(hour);
  slider.addEventListener('input', () => setHour(parseFloat(slider.value)));
  const presets = h('div', { class: 'chips wrap' }, TIME_PRESETS.map((p) => h('button', { class: 'chip', onclick: () => setHour(p.h) }, t(p.key))));
  const flow = h('select', { class: 'select', onchange: (e: Event) => {
    const v = parseFloat((e.target as HTMLSelectElement).value);
    if (env) env.speed = v;
    setPrefs({ timeFlow: v });
  } }, FLOWS.map((f) => h('option', { value: String(f.v), selected: Math.abs((prefs.timeFlow ?? 0) - f.v) < 1e-6 }, t(f.key))));
  const dof = h('input', { type: 'checkbox', checked: prefs.dof !== false, onchange: (e: Event) => {
    const on = (e.target as HTMLInputElement).checked;
    setPrefs({ dof: on });
    getStage().post.dof = on ? 1 : 0;
  } });
  // keep the slider in sync when time flows
  if (env) {
    const tick = () => {
      if (!slider.isConnected) return;
      if (env.speed && document.activeElement !== slider) {
        slider.value = String(env.hour);
        label.textContent = hourLabel(env.hour);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return h('div', { class: 'time-controls' },
    h('div', { class: 'row between' }, h('span', null, icon, ' ', t('time.title')), label),
    slider,
    presets,
    h('div', { class: 'row between' }, h('span', { class: 'dim small' }, t('time.flow')), flow),
    h('label', { class: 'row small dim' }, dof, t('time.dof')),
  );
}
