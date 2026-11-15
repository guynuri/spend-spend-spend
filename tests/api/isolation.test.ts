/**
 * Household isolation suite (PLAN §15.3). Every route registered on the app must be classified
 * below; tenant routes are called as a member of A with B's ids and must never succeed or leak.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/server/app';
import { TENANT_TABLES } from '../../src/server/db/tables';
import { tenantDb, UnscopedSqlError } from '../../src/server/db/tenant';
import { DB, call, json, makeUser, sessionFor } from './helpers';
import { buildIsolationFixture, type IsoFixture } from './isolationFixture';

type Cls = 'public' | 'auth' | 'admin' | 'tenant';
/** METHOD path → classification. A new route without an entry fails the suite. */
export const ROUTES: Record<string, Cls> = {
  'GET /api/health': 'public',
  'POST /api/auth/register/options': 'public',
  'POST /api/auth/register/verify': 'public',
  'POST /api/auth/login/options': 'public',
  'POST /api/auth/login/verify': 'public',
  'POST /api/auth/logout': 'public',
  'POST /api/invites/inspect': 'public',
  'POST /api/auth/logout-all': 'auth',
  'GET /api/auth/passkeys': 'auth',
  'POST /api/auth/passkeys/options': 'auth',
  'POST /api/auth/passkeys': 'auth',
  'DELETE /api/auth/passkeys/:id': 'auth',
  'GET /api/me': 'auth',
  'PATCH /api/me': 'auth',
  'POST /api/session/household': 'auth',
  'POST /api/invites/accept': 'auth',
  'GET /api/admin/households': 'admin',
  'POST /api/admin/households': 'admin',
  'PATCH /api/admin/households/:id': 'admin',
  'POST /api/admin/households/:id/owner-invite': 'admin',
  'POST /api/admin/users/:id/recovery': 'admin',
  'GET /api/household': 'tenant',
  'PATCH /api/household': 'tenant',
  'GET /api/household/members': 'tenant',
  'PATCH /api/household/members/:userId': 'tenant',
  'DELETE /api/household/members/:userId': 'tenant',
  'GET /api/household/invites': 'tenant',
  'POST /api/household/invites': 'tenant',
  'DELETE /api/household/invites/:id': 'tenant',
  'POST /api/household/members/:userId/recovery': 'tenant',
  'POST /api/household/sample-data': 'tenant',
  'GET /api/accounts': 'tenant',
  'POST /api/accounts': 'tenant',
  'PATCH /api/accounts/:id': 'tenant',
  'DELETE /api/accounts/:id': 'tenant',
  'POST /api/accounts/:id/balance': 'tenant',
  'GET /api/categories': 'tenant',
  'POST /api/categories': 'tenant',
  'PATCH /api/categories/:id': 'tenant',
  'DELETE /api/categories/:id': 'tenant',
  'GET /api/rules': 'tenant',
  'POST /api/rules': 'tenant',
  'PATCH /api/rules/:id': 'tenant',
  'DELETE /api/rules/:id': 'tenant',
  'POST /api/rules/apply': 'tenant',
  'GET /api/transactions': 'tenant',
  'GET /api/transactions/export.csv': 'tenant',
  'POST /api/transactions': 'tenant',
  'PATCH /api/transactions/:id': 'tenant',
  'POST /api/transactions/undo-learn': 'tenant',
  'DELETE /api/transactions/:id': 'tenant',
  'PUT /api/transactions/:id/splits': 'tenant',
  'GET /api/transactions/:id/split-suggestion': 'tenant',
  'POST /api/transactions/bulk': 'tenant',
  'POST /api/imports/preview': 'tenant',
  'POST /api/imports': 'tenant',
  'POST /api/imports/:id/rows': 'tenant',
  'POST /api/imports/:id/commit': 'tenant',
  'GET /api/imports': 'tenant',
  'DELETE /api/imports/:id': 'tenant',
  'GET /api/import-profiles': 'tenant',
  'PUT /api/import-profiles': 'tenant',
  'GET /api/budgets': 'tenant',
  'PUT /api/budgets': 'tenant',
  'GET /api/trends/categories': 'tenant',
  'GET /api/trends/daily': 'tenant',
  'GET /api/trends/monthly': 'tenant',
  'GET /api/recurring': 'tenant',
  'POST /api/recurring': 'tenant',
  'PATCH /api/recurring/:id': 'tenant',
  'DELETE /api/recurring/:id': 'tenant',
  'POST /api/recurring/detect': 'tenant',
  'PUT /api/recurring/:id/overrides/:dueDate': 'tenant',
  'GET /api/planned': 'tenant',
  'POST /api/planned': 'tenant',
  'PATCH /api/planned/:id': 'tenant',
  'DELETE /api/planned/:id': 'tenant',
  'GET /api/forecast': 'tenant',
  'GET /api/upcoming': 'tenant',
  'GET /api/goals': 'tenant',
  'POST /api/goals': 'tenant',
  'PATCH /api/goals/:id': 'tenant',
  'DELETE /api/goals/:id': 'tenant',
  'POST /api/goals/:id/contributions': 'tenant',
  'DELETE /api/goals/:id/contributions/:cid': 'tenant',
  'GET /api/health-score': 'tenant',
  'GET /api/dashboard': 'tenant',
  'POST /api/household/reset': 'tenant',
  'DELETE /api/household': 'tenant',
  'GET /api/reviews': 'tenant',
  'GET /api/reviews/:month': 'tenant',
  'POST /api/reviews/:month/complete': 'tenant',
};

const CANARY = 'ZZ-B-CANARY';
/** Path params that are not tenant-owned ids (a month or a due date is valid in any household). */
const NON_ID_PARAMS = new Set(['month', 'dueDate']);
const idParams = (pattern: string) => [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]!).filter((p) => !NON_ID_PARAMS.has(p));

function registered() {
  const seen = new Set<string>();
  for (const r of app.routes) {
    if (r.method === 'ALL') continue;
    seen.add(`${r.method} ${r.path.replace(/\/$/, '') || '/'}`);
  }
  return [...seen];
}

let fx: IsoFixture;
beforeAll(async () => {
  fx = await buildIsolationFixture();
});

async function snapshotB() {
  const out: Record<string, string> = {};
  for (const t of TENANT_TABLES) {
    const rows = await DB.prepare(`SELECT * FROM ${t} WHERE household_id = ?1 ORDER BY 1`).bind(fx.b.householdId).all();
    out[t] = JSON.stringify(rows.results);
  }
  const g = await DB.prepare('SELECT (SELECT json_group_array(json_object(\'u\', user_id, \'r\', role)) FROM memberships WHERE household_id = ?1) m, (SELECT json_group_array(id || coalesce(revoked_at,\'\') || coalesce(used_at,\'\')) FROM invites WHERE household_id = ?1) i, (SELECT name || status FROM households WHERE id = ?1) h').bind(fx.b.householdId).first();
  out.global = JSON.stringify(g);
  return out;
}

describe('route classification', () => {
  it('every registered route is classified, and every classified route exists', () => {
    const reg = registered();
    expect(reg.filter((r) => !(r in ROUTES)), 'unclassified routes').toEqual([]);
    expect(Object.keys(ROUTES).filter((r) => !reg.includes(r)), 'stale entries').toEqual([]);
  });
});

describe('tenant routes with B ids → 404 (or 400), B unchanged', () => {
  it('cross-household access never succeeds', async () => {
    const before = await snapshotB();
    const failures: string[] = [];
    for (const [key, cls] of Object.entries(ROUTES)) {
      if (cls !== 'tenant') continue;
      const [method, pattern] = key.split(' ') as [string, string];
      if (!idParams(pattern).length) continue;
      const path = pattern.replace(/:(\w+)/g, (_, p: string) => fx.idForB(pattern, p));
      const body = fx.bodyFor(key, 'B');
      const r = await json(method, path, { cookie: fx.a.ownerCookie, body });
      if (![400, 404].includes(r.status)) failures.push(`${key} → ${r.status}`);
      if (JSON.stringify(r.body ?? '').includes(CANARY)) failures.push(`${key} leaked canary`);
    }
    expect(failures).toEqual([]);
    expect(await snapshotB()).toEqual(before);
  });

  it('id-typed body fields pointing at B are rejected for routes without path ids', async () => {
    const before = await snapshotB();
    const failures: string[] = [];
    for (const [key, cls] of Object.entries(ROUTES)) {
      if (cls !== 'tenant') continue;
      const [method, pattern] = key.split(' ') as [string, string];
      if (method === 'GET' || idParams(pattern).length) continue;
      const body = fx.bodyFor(key, 'B');
      if (body === undefined) continue;
      const r = await json(method, pattern, { cookie: fx.a.ownerCookie, body });
      if (![400, 404].includes(r.status)) failures.push(`${key} → ${r.status}`);
    }
    expect(failures).toEqual([]);
    expect(await snapshotB()).toEqual(before);
  });
});

describe('A path ids with B ids in the body → 404, B unchanged', () => {
  it('foreign ids in payloads are rejected (assertOwned)', async () => {
    const before = await snapshotB();
    const failures: string[] = [];
    for (const [key, cls] of Object.entries(ROUTES)) {
      if (cls !== 'tenant') continue;
      const [method, pattern] = key.split(' ') as [string, string];
      if (method === 'GET' || !pattern.includes(':')) continue;
      const bBody = fx.bodyFor(key, 'B');
      const aBody = fx.bodyFor(key, 'A');
      if (bBody === undefined || JSON.stringify(bBody) === JSON.stringify(aBody)) continue;
      const path = pattern.replace(/:(\w+)/g, (_, p: string) => fx.idForA(pattern, p));
      const r = await json(method, path, { cookie: fx.a.ownerCookie, body: bBody });
      if (![400, 404].includes(r.status)) failures.push(`${key} → ${r.status}`);
    }
    expect(failures).toEqual([]);
    expect(await snapshotB()).toEqual(before);
  });
});

describe('no leakage in GET responses', () => {
  it('as A, every GET route (A ids and no ids) never contains the canary', async () => {
    const leaks: string[] = [];
    for (const [key, cls] of Object.entries(ROUTES)) {
      const [method, pattern] = key.split(' ') as [string, string];
      if (method !== 'GET' || cls === 'admin') continue;
      const path = pattern.replace(/:(\w+)/g, (_, p: string) => fx.idForA(pattern, p));
      for (const q of fx.queriesFor(pattern)) {
        const res = await call(method, path + q, { cookie: fx.a.ownerCookie });
        const text = await res.text();
        if (text.includes(CANARY) || text.includes('ZZ-B-META')) leaks.push(`${key}${q}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('admin responses carry no tenant content', async () => {
    const admin = await makeUser('Root', true);
    const cookie = await sessionFor(admin, null);
    const r = await json('GET', '/api/admin/households', { cookie });
    const s = JSON.stringify(r.body);
    expect(s).not.toContain(CANARY);
    expect(s).not.toMatch(/amount|description|balance/i);
  });
});

describe('registry and helper guarantees', () => {
  it('TENANT_TABLES covers every table with a household_id column', async () => {
    const tables = await DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>();
    const withHh: string[] = [];
    for (const { name } of tables.results) {
      const cols = await DB.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
      if (cols.results.some((c) => c.name === 'household_id')) withHh.push(name);
    }
    // memberships and invites reference a household but are global (auth) tables, reached only via db/global.ts.
    const GLOBAL_WITH_HOUSEHOLD = ['invites', 'memberships'];
    expect(withHh.filter((t) => !GLOBAL_WITH_HOUSEHOLD.includes(t)).sort()).toEqual([...TENANT_TABLES].sort());
  });

  it('tenantDb throws on SQL lacking household_id = ?1, and insert rejects household_id', async () => {
    const q = tenantDb(DB, fx.a.householdId);
    await expect(async () => q.all('SELECT * FROM accounts')).rejects.toThrow(UnscopedSqlError);
    await expect(async () => q.first('SELECT * FROM accounts WHERE household_id = ?2', 'x')).rejects.toThrow(UnscopedSqlError);
    await expect(async () => q.run('DELETE FROM accounts')).rejects.toThrow(UnscopedSqlError);
    expect(() => q.insertStmt('accounts', { household_id: 'x' })).toThrow();
    expect(() => q.insertStmt('users', { id: 'x' })).toThrow();
  });
});
