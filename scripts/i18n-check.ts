// Verifies every locale covers the same keys and {placeholders} as en.
import en from '../src/i18n/locales/en';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/i18n/locales/', import.meta.url));
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let bad = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'en.ts')) {
  const dict: Record<string, string> = (await import(`../src/i18n/locales/${f}`)).default;
  const problems: string[] = [];
  for (const [k, v] of Object.entries(en)) {
    const tr = dict[k];
    if (tr == null) problems.push(`missing ${k}`);
    else if (ph(tr) !== ph(v as string)) problems.push(`placeholders ${k}: ${ph(v as string)} ≠ ${ph(tr)}`);
  }
  for (const k of Object.keys(dict)) if (!(k in en)) problems.push(`extra ${k}`);
  console.log(`${problems.length ? '✗' : '✓'} ${f} (${Object.keys(dict).length} keys)`);
  for (const p of problems) console.log('   ' + p);
  bad += problems.length;
}
process.exit(bad ? 1 : 0);
