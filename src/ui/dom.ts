import { t } from '../i18n';
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, any> & { class?: string; style?: string | Partial<CSSStyleDeclaration> };

/** Minimal hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Range inputs paint their filled part from a `--p` custom property (see style.css). */
function syncRange(el: HTMLInputElement) {
  const min = parseFloat(el.min || '0'), max = parseFloat(el.max || '100');
  const p = max > min ? ((parseFloat(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', `${Math.max(0, Math.min(100, p))}%`);
}

export function initRangeFill() {
  const isRange = (n: unknown): n is HTMLInputElement => n instanceof HTMLInputElement && n.type === 'range';
  document.addEventListener('input', (e) => { if (isRange(e.target)) syncRange(e.target); }, true);
  // programmatic value changes (and freshly mounted sliders) don't fire input events
  const scan = () => document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(syncRange);
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 500);
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function toast(msg: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2200) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function confirmDialog(msg: string, okLabel = t('common.ok')): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean) => { wrap.remove(); resolve(v); };
    const wrap = h('div', { class: 'modal-wrap' },
      h('div', { class: 'modal panel' },
        h('p', null, msg),
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => close(false) }, t('common.cancel')),
          h('button', { class: 'btn danger', onclick: () => close(true) }, okLabel),
        ),
      ),
    );
    document.body.append(wrap);
  });
}
