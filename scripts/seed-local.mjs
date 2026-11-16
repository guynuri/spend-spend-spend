// Loads the sample household into the LOCAL D1 used by `npm run dev`.
// Usage: npm run seed:local [-- --household <id>] [--locale he|en] [--persist-to <dir>]
// Without --household it seeds the first household that has no transactions.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const persist = args.includes('--persist-to') ? ['--persist-to', opt('--persist-to')] : [];
const env = { ...process.env, CI: '1' };
const d1 = (sqlOrFile, isFile = false) => {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'maazan', '--local', ...persist, '--json', isFile ? '--file' : '--command', sqlOrFile], { encoding: 'utf8', env, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
};
let hid = opt('--household');
if (!hid) {
  const rows = d1('SELECT h.id FROM households h WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = h.id) AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.household_id = h.id) ORDER BY h.created_at LIMIT 1')[0].results;
  if (!rows.length) {
    console.error('No empty household found. Complete /setup first, or pass --household <id>.');
    process.exit(1);
  }
  hid = rows[0].id;
}
const hh = d1(`SELECT locale, timezone FROM households WHERE id = '${hid.replace(/'/g, '')}'`)[0].results[0];
const locale = opt('--locale', hh.locale === 'he' ? 'he' : 'en');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: hh.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const cats = d1(`SELECT id, name, kind, system_key FROM categories WHERE household_id = '${hid}'`)[0].results;
const dir = mkdtempSync(path.join(tmpdir(), 'mz-seed-'));
const bundle = path.join(dir, 'seed.mjs');
const b = spawnSync('npx', ['esbuild', 'scripts/seed-entry.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'inherit', env });
if (b.status !== 0) process.exit(1);
const sql = spawnSync('node', [bundle, hid, today, locale, JSON.stringify(cats)], { encoding: 'utf8', maxBuffer: 64 << 20 });
if (sql.status !== 0) throw new Error(sql.stderr);
const file = path.join(dir, 'seed.sql');
writeFileSync(file, sql.stdout);
d1(file, true);
console.log(`Sample data loaded into household ${hid} (${locale}, today ${today}).`);
