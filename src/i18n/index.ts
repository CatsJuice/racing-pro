import en, { type Key } from './locales/en';

export type { Key };
type Dict = Partial<Record<Key, string>>;

/** Supported languages; dictionaries are loaded on demand. */
export const LANGS: { code: string; name: string; load: () => Promise<{ default: Dict }> }[] = [
  { code: 'en', name: 'English', load: async () => ({ default: en }) },
  { code: 'zh-CN', name: '简体中文', load: () => import('./locales/zh-CN') },
  { code: 'zh-TW', name: '繁體中文', load: () => import('./locales/zh-TW') },
  { code: 'ja', name: '日本語', load: () => import('./locales/ja') },
  { code: 'ko', name: '한국어', load: () => import('./locales/ko') },
  { code: 'es', name: 'Español', load: () => import('./locales/es') },
  { code: 'fr', name: 'Français', load: () => import('./locales/fr') },
  { code: 'de', name: 'Deutsch', load: () => import('./locales/de') },
  { code: 'pt', name: 'Português', load: () => import('./locales/pt') },
  { code: 'ru', name: 'Русский', load: () => import('./locales/ru') },
  { code: 'it', name: 'Italiano', load: () => import('./locales/it') },
  { code: 'tr', name: 'Türkçe', load: () => import('./locales/tr') },
  { code: 'vi', name: 'Tiếng Việt', load: () => import('./locales/vi') },
  { code: 'th', name: 'ภาษาไทย', load: () => import('./locales/th') },
  { code: 'id', name: 'Bahasa Indonesia', load: () => import('./locales/id') },
  { code: 'pl', name: 'Polski', load: () => import('./locales/pl') },
];

const PREF_KEY = 'racing-pro.lang';
let current = 'en';
let dict: Dict = en;

/** Best match of the browser's preferred languages against the supported list. */
export function detectLang(): string {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  for (const raw of prefs) {
    const l = raw.toLowerCase();
    if (l.startsWith('zh')) {
      // Traditional for TW/HK/MO and explicit Hant, Simplified otherwise
      return /hant|tw|hk|mo/.test(l) ? 'zh-TW' : 'zh-CN';
    }
    const base = l.split('-')[0];
    const hit = LANGS.find((x) => x.code.toLowerCase() === l || x.code.toLowerCase() === base);
    if (hit) return hit.code;
  }
  return 'en';
}

export function savedLang(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

/** Loads the dictionary; call once before rendering any UI. */
export async function initI18n() {
  const want = savedLang() ?? detectLang();
  const entry = LANGS.find((l) => l.code === want) ?? LANGS[0];
  try {
    dict = (await entry.load()).default;
    current = entry.code;
  } catch {
    dict = en;
    current = 'en';
  }
  document.documentElement.lang = current;
}

export function lang() {
  return current;
}

/** Switch language (persisted) — reloads the page so every screen re-renders. */
export function setLang(code: string) {
  try {
    localStorage.setItem(PREF_KEY, code);
  } catch {
    /* ignore */
  }
  location.reload();
}

/** Translate `key`, replacing `{name}` placeholders. Missing entries fall back to English. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let s = dict[key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Same as t() but for dynamic keys (e.g. `p.${param}`), falling back to `fallback`. */
export function tx(key: string, fallback = key, params?: Record<string, string | number>): string {
  const s = (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key];
  return s === undefined ? fallback : t(key as Key, params);
}

export function fmtDate(ms: number, withTime = false) {
  const d = new Date(ms);
  return withTime ? d.toLocaleString(current) : d.toLocaleDateString(current);
}

/** Display names: built-in tracks/cars are translated, user-made ones keep their own names. */
export function trackName(tr: { id: string; name: string; builtin?: boolean }) {
  return tr.builtin ? tx(`track.${tr.id}`, tr.name) : tr.name;
}

export function carName(c: { id: string; name: string; builtin?: boolean }) {
  return c.builtin ? tx(`car.${c.id}`, c.name) : c.name;
}
