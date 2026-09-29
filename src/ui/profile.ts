import { t } from '../i18n';
import { identity, onIdentity, randomName, register, rename } from '../core/online';
import { h, toast } from './dom';

/** Modal asking for a player name. Resolves with the saved name, or null if cancelled. */
export function nameDialog(opts: { first?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const cur = identity();
    const input = h('input', { class: 'text', maxlength: 16, value: cur?.name ?? randomName(), placeholder: t('profile.placeholder') });
    const err = h('div', { class: 'bad small' });
    const btn = h('button', { class: 'btn primary' }, opts.first ? t('profile.start') : t('common.save'));
    const close = (v: string | null) => { wrap.remove(); resolve(v); };
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { err.textContent = t('profile.required'); return; }
      btn.disabled = true;
      try {
        const r = cur ? await rename(name) : await register(name);
        toast(t('profile.hello', { name: r.name }), 'good');
        close(r.name);
      } catch (e) {
        err.textContent = (e as Error).message;
        btn.disabled = false;
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    btn.addEventListener('click', submit);
    const wrap = h('div', { class: 'modal-wrap' },
      h('div', { class: 'modal panel name-dialog' },
        h('h2', null, opts.first ? t('profile.welcome') : t('profile.rename')),
        h('p', { class: 'dim' }, opts.first ? t('profile.welcomeText') : t('profile.renameText')),
        input,
        err,
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => close(null) }, opts.first ? t('profile.later') : t('common.cancel')),
          btn,
        ),
      ),
    );
    document.body.append(wrap);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/** Small "👤 name ✏️" chip that stays in sync with the identity. */
export function playerBadge(): HTMLElement {
  const label = h('b', null, identity()?.name ?? t('profile.unset'));
  const el = h('button', { class: 'player-badge', title: t('profile.editTitle'), onclick: () => nameDialog() }, h('span', { class: 'avatar' }, '👤'), label, h('span', { class: 'edit' }, '✏️'));
  const off = onIdentity((i) => {
    if (!el.isConnected) return off();
    label.textContent = i.name;
  });
  return el;
}
