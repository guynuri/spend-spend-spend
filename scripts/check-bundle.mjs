// Bundle budget (PLAN M10): initial JS ≤ 250 kB gzip; SheetJS and Recharts only in lazy chunks.
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const html = readFileSync('dist/client/index.html', 'utf8');
const entries = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
let total = 0;
const fail = [];
for (const e of entries) {
  const code = readFileSync(`dist/client/${e}`);
  total += gzipSync(code).length;
  const s = code.toString('utf8');
  if (/SheetJS|sheet_to_json/.test(s)) fail.push(`${e} contains SheetJS`);
  if (/recharts-wrapper|recharts-surface/.test(s)) fail.push(`${e} contains Recharts`);
}
const kb = (total / 1024).toFixed(1);
const lazy = readdirSync('dist/client/assets').filter((f) => f.endsWith('.js')).length - entries.length;
console.log(`initial JS: ${entries.length} file(s), ${kb} kB gzip; ${lazy} lazy chunks`);
if (total > 250 * 1024) fail.push(`initial JS ${kb} kB gzip > 250 kB`);
if (fail.length) {
  console.error(fail.join('\n'));
  process.exit(1);
}
