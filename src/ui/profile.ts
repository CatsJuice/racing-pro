import { identity, onIdentity, randomName, register, rename } from '../core/online';
import { h, toast } from './dom';

/** Modal asking for a player name. Resolves with the saved name, or null if cancelled. */
export function nameDialog(opts: { first?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const cur = identity();
    const input = h('input', { class: 'text', maxlength: 16, value: cur?.name ?? randomName(), placeholder: '1-16 个字符' });
    const err = h('div', { class: 'bad small' });
    const btn = h('button', { class: 'btn primary' }, opts.first ? '开始比赛 ▶' : '保存');
    const close = (v: string | null) => { wrap.remove(); resolve(v); };
    const submit = async () => {
      const name = input.value.trim();
      if (!name) { err.textContent = '请输入用户名'; return; }
      btn.disabled = true;
      try {
        const r = cur ? await rename(name) : await register(name);
        toast(`你好，${r.name}！`, 'good');
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
        h('h2', null, opts.first ? '🏁 欢迎来到 Racing Pro' : '✏️ 修改用户名'),
        h('p', { class: 'dim' }, opts.first ? '起一个车手名吧，官方赛道的圈速会以这个名字登上全球圈速榜。' : '新名字会立即显示在全球圈速榜上。'),
        input,
        err,
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => close(null) }, opts.first ? '稍后再说' : '取消'),
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
  const label = h('b', null, identity()?.name ?? '未设置车手名');
  const el = h('button', { class: 'player-badge', title: '修改用户名', onclick: () => nameDialog() }, h('span', { class: 'avatar' }, '👤'), label, h('span', { class: 'edit' }, '✏️'));
  const off = onIdentity((i) => {
    if (!el.isConnected) return off();
    label.textContent = i.name;
  });
  return el;
}
