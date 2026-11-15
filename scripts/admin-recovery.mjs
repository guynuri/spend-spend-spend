// Issues a single-use recovery link for the super-admin (PLAN AC1.9).
// Local:   npm run admin:recovery                       (uses the local D1 of `npm run dev`)
// Remote:  npm run admin:recovery -- --remote --url https://maazan.<sub>.workers.dev
// The link is printed to this terminal only. Never paste it into a committed file.
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const urlArg = args[args.indexOf('--url') + 1];
const base = (args.includes('--url') ? urlArg : 'http://localhost:5173').replace(/\/$/, '');
const persist = args.includes('--persist-to') ? ['--persist-to', args[args.indexOf('--persist-to') + 1]] : [];
if (remote && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const id = randomUUID().replace(/-/g, '').slice(0, 21);
const now = new Date();
const exp = new Date(now.getTime() + 2 * 86_400_000);
const sql = `INSERT INTO invites (id, token_hash, kind, household_id, role, target_user_id, created_at, expires_at)
SELECT '${id}', '${hash}', 'recovery', NULL, NULL, id, '${now.toISOString()}', '${exp.toISOString()}'
FROM users WHERE is_super_admin = 1 ORDER BY created_at LIMIT 1;
SELECT COUNT(*) AS n FROM invites WHERE id = '${id}';`;
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'maazan', remote ? '--remote' : '--local', ...persist, ...(remote ? ['--env', 'production'] : []), '--json', '--command', sql], {
  encoding: 'utf8',
  env: { ...process.env, CI: '1' },
});
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
let changes = 0;
try {
  const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  changes = out[out.length - 1]?.results?.[0]?.n ?? 0;
} catch {
  /* unexpected output */
}
if (!changes) {
  console.error('No super-admin found (has /setup been completed?).');
  process.exit(1);
}
console.log(`\nRecovery link for the super-admin (single use, valid 48 h):\n\n  ${base}/recover#${token}\n`);
