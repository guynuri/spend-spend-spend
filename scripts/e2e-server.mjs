// Starts the built app on a fresh local D1 for Playwright (PLAN §15.4).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const port = process.env.MZ_E2E_PORT ?? '8799';
const persist = '.wrangler/e2e';
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, CI: '1' }, shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!process.env.MZ_SKIP_BUILD || !existsSync('dist/maazan/wrangler.json')) run('npx', ['vite', 'build']);
rmSync(persist, { recursive: true, force: true });
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'maazan', '--local', '--persist-to', persist]);
const child = spawn(
  'npx',
  [
    'wrangler', 'dev', '-c', 'dist/maazan/wrangler.json', '--persist-to', persist, '--port', port,
    '--ip', '127.0.0.1', '--var', 'AI_PROVIDER:mock', '--var', 'BOOTSTRAP_TOKEN:e2e-bootstrap', '--var', 'RATE_LIMIT_AUTH:100000', '--log-level', 'warn',
  ],
  { stdio: 'inherit', env: { ...process.env, CI: '1' }, shell: process.platform === 'win32' },
);
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
