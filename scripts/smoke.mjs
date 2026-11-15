// Deployed smoke test (PLAN §15.5). Usage: node scripts/smoke.mjs https://maazan.<sub>.workers.dev
// No credentials needed. Exits non-zero on any failure.
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/smoke.mjs <baseUrl>');
  process.exit(2);
}
const origin = new URL(base).origin;
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push([name, true]);
  } catch (e) {
    results.push([name, false, e.message]);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const get = (p, init) => fetch(base + p, { redirect: 'manual', ...init });
const sec = (res) => {
  for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'strict-transport-security']) assert(res.headers.get(h), `missing ${h}`);
};

await check('GET /api/health → ok + db', async () => {
  const r = await get('/api/health');
  assert(r.status === 200, `status ${r.status}`);
  const j = await r.json();
  assert(j.ok === true && j.db === true, JSON.stringify(j));
  assert(r.headers.get('cache-control') === 'no-store', 'API not no-store');
  sec(r);
});
await check('GET / → SPA shell with manifest link + security headers', async () => {
  const r = await get('/');
  assert(r.status === 200, `status ${r.status}`);
  assert((await r.text()).includes('rel="manifest"'), 'no manifest link');
  sec(r);
});
await check('GET /manifest.webmanifest → JSON', async () => {
  const r = await get('/manifest.webmanifest');
  assert(r.status === 200, `status ${r.status}`);
  const j = await r.json();
  assert(j.display === 'standalone', 'display');
});
await check('GET /api/me without session → 401', async () => assert((await get('/api/me')).status === 401, 'not 401'));
await check('POST /api/transactions without session → 401/403', async () => {
  const r = await get('/api/transactions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mz': '1', origin }, body: '{}' });
  assert([401, 403].includes(r.status), `status ${r.status}`);
});
await check('POST /api/auth/login/options → challenge', async () => {
  const r = await get('/api/auth/login/options', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mz': '1', origin }, body: '{}' });
  assert(r.status === 200, `status ${r.status}`);
  const j = await r.json();
  assert(j.challengeId && j.options?.challenge, 'no challenge');
});
await check('GET /api/does-not-exist → 404 JSON', async () => {
  const r = await get('/api/does-not-exist');
  assert(r.status === 404, `status ${r.status}`);
  assert((await r.json()).error?.code === 'not_found', 'error envelope');
});
await check('deep link /budget → SPA shell', async () => {
  const r = await get('/budget', { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
  assert(r.status === 200 && (await r.text()).includes('id="root"'), `status ${r.status}`);
});

for (const [n, ok, err] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : `  — ${err}`}`);
const failed = results.filter((r) => !r[1]).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nall smoke checks passed');
process.exit(failed ? 1 : 0);
