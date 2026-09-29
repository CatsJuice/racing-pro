import { lang, LANGS, setLang } from '../i18n';
import { h } from './dom';

/** Language selector (native names). Changing it reloads the app. */
export function langPicker(): HTMLElement {
  const cur = lang();
  return h('label', { class: 'lang-picker', title: 'Language' },
    h('span', null, '🌐'),
    h('select', { onchange: (e: Event) => setLang((e.target as HTMLSelectElement).value) },
      LANGS.map((l) => h('option', { value: l.code, selected: l.code === cur }, l.name))),
  );
}
