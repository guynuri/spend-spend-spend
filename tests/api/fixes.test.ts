/** Regression tests for the PR review findings. */
import { describe, expect, it } from 'vitest';
import { DB, addMember, call, json, makeHousehold, makeInvite, makeUser, ownerSetup, sessionFor } from './helpers';
import type { Tx } from '../../src/shared/schemas/ledger';
import type { PreviewResponse, WireRow } from '../../src/shared/schemas/imports';

async function withAccount() {
  const o = await ownerSetup();
  const acc = (await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Checking', type: 'checking' } })).body.id;
  const cats = (await json<{ categories: { id: string; name: string }[] }>('GET', '/api/categories', { cookie: o.cookie })).body.categories;
  return { ...o, acc, cat: (n: string) => cats.find((c) => c.name === n)!.id };
}
const wire = (n: number, date: string, amountMinor: number, description: string): WireRow => ({ row: n, date, valueDate: null, amountMinor, description, reference: `r${n}`, operationType: null, balanceMinor: null, occ: 1 });
async function importRows(s: Awaited<ReturnType<typeof withAccount>>, rows: WireRow[], closing: { date: string; minor: number } | null = null) {
  const pv = await json<PreviewResponse>('POST', '/api/imports/preview', { cookie: s.cookie, body: { accountId: s.acc, rows } });
  const id = (await json<{ importId: string }>('POST', '/api/imports', { cookie: s.cookie, body: { accountId: s.acc, parserId: 'generic', fileName: 'f', fileHash: 'f'.repeat(64), period: null, rowsTotal: rows.length, rowsError: 0, closingBalance: closing } })).body.importId;
  await json('POST', `/api/imports/${id}/rows`, { cookie: s.cookie, body: { rows } });
  await json('POST', `/api/imports/${id}/commit`, { cookie: s.cookie });
  return { pv: pv.body, id };
}

describe('review fixes — server', () => {
  it('owners cannot mint recovery links for the super-admin or for people in other households', async () => {
    const o = await ownerSetup();
    const admin = await makeUser('Admin', true);
    await addMember(o.householdId, admin, 'member');
    const multi = await makeUser('Multi');
    await addMember(o.householdId, multi, 'member');
    await addMember(await makeHousehold('Elsewhere'), multi, 'member');
    const local = await makeUser('Local');
    await addMember(o.householdId, local, 'member');
    for (const uid of [admin, multi]) expect((await json<{ error: { code: string } }>('POST', `/api/household/members/${uid}/recovery`, { cookie: o.cookie })).body.error.code).toBe('recovery_needs_admin');
    expect((await json('POST', `/api/household/members/${local}/recovery`, { cookie: o.cookie })).status).toBe(201);
  });

  it('CSV export keeps negative amounts numeric', async () => {
    const s = await withAccount();
    await json('POST', '/api/transactions', { cookie: s.cookie, body: { date: '2026-04-02', amountMinor: 1250, direction: 'out', description: 'x', accountId: s.acc } });
    const text = await (await call('GET', '/api/transactions/export.csv?from=2026-04-01&to=2026-04-30', { cookie: s.cookie })).text();
    expect(text).toContain(',-12.50,');
    expect(text).not.toContain("'-12.50");
  });

  it('card issuers match whole words only; preview and commit agree', async () => {
    const s = await withAccount();
    const rows = [wire(1, '2026-10-01', -5000, 'העברה למיכאל'), wire(2, '2026-10-02', -6000, 'מקסים ובניו'), wire(3, '2026-10-03', -700000, 'CAL-ONLINE 1234'), wire(4, '2026-10-04', -800000, 'ישראכרט חיוב')];
    const { pv } = await importRows(s, rows);
    expect(pv.rows.map((r) => r.kind)).toEqual(['normal', 'normal', 'card_lump', 'card_lump']);
    const stored = await DB.prepare('SELECT description, kind FROM transactions WHERE household_id = ?1 ORDER BY date').bind(s.householdId).all<{ kind: string }>();
    expect(stored.results.map((r) => r.kind)).toEqual(['normal', 'normal', 'card_lump', 'card_lump']);
  });

  it('an import never overwrites a manual balance; undo keeps it', async () => {
    const s = await withAccount();
    await json('POST', `/api/accounts/${s.acc}/balance`, { cookie: s.cookie, body: { date: '2026-10-05', balanceMinor: 12345 } });
    const { id } = await importRows(s, [wire(1, '2026-10-05', -100, 'x')], { date: '2026-10-05', minor: 99999 });
    await json('DELETE', `/api/imports/${id}`, { cookie: s.cookie });
    const b = await DB.prepare('SELECT balance_minor, source FROM account_balances WHERE household_id = ?1').bind(s.householdId).first();
    expect(b).toEqual({ balance_minor: 12345, source: 'manual' });
  });

  it('an unfinished import is discarded entirely when undone', async () => {
    const s = await withAccount();
    const id = (await json<{ importId: string }>('POST', '/api/imports', { cookie: s.cookie, body: { accountId: s.acc, parserId: 'generic', fileName: 'f', fileHash: 'f'.repeat(64), period: null, rowsTotal: 1, rowsError: 0, closingBalance: null } })).body.importId;
    await json('POST', `/api/imports/${id}/rows`, { cookie: s.cookie, body: { rows: [wire(1, '2026-10-05', -100, 'x')] } });
    expect((await json<{ discarded: boolean }>('DELETE', `/api/imports/${id}?onlyOpen=1`, { cookie: s.cookie })).body.discarded).toBe(true);
    // the cleanup call never undoes a committed import
    const done = await importRows(s, [wire(2, '2026-10-06', -100, 'y')]);
    expect((await json('DELETE', `/api/imports/${done.id}?onlyOpen=1`, { cookie: s.cookie })).status).toBe(409);
    expect(await DB.prepare('SELECT id FROM imports WHERE id = ?1').bind(id).first()).toBeNull();
  });

  it('deleting a matched transaction puts its planned expense back to planned', async () => {
    const s = await withAccount();
    const p = (await json<{ id: string }>('POST', '/api/planned', { cookie: s.cookie, body: { name: 'Test', amountMinor: 145000, date: '2026-10-10', accountId: s.acc } })).body.id;
    const tx = (await json<Tx>('POST', '/api/transactions', { cookie: s.cookie, body: { date: '2026-10-11', amountMinor: 145000, direction: 'out', description: 'garage', accountId: s.acc } })).body;
    expect((await DB.prepare('SELECT status FROM planned_expenses WHERE id = ?1').bind(p).first<{ status: string }>())!.status).toBe('done');
    await json('DELETE', `/api/transactions/${tx.id}`, { cookie: s.cookie });
    expect(await DB.prepare('SELECT status, matched_tx_id FROM planned_expenses WHERE id = ?1').bind(p).first()).toEqual({ status: 'planned', matched_tx_id: null });
  });

  it('undo after re-pointing an existing learned rule restores it instead of deleting it', async () => {
    const s = await withAccount();
    const add = async (d: string) => (await json<Tx>('POST', '/api/transactions', { cookie: s.cookie, body: { date: d, amountMinor: 100, direction: 'out', description: 'Corner Shop', accountId: s.acc } })).body;
    const a = await add('2026-10-01');
    await json('PATCH', `/api/transactions/${a.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Groceries') } });
    const b = await add('2026-10-02');
    expect(b.categoryId).toBe(s.cat('Groceries'));
    await add('2026-10-03');
    await json('PATCH', `/api/transactions/${b.id}`, { cookie: s.cookie, body: { categoryId: null } });
    const r = await json<{ learned: { ruleId: string; txIds: string[]; previous: { categoryId: string; source: string } | null } }>('PATCH', `/api/transactions/${b.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Home') } });
    expect(r.body.learned.previous).toEqual({ categoryId: s.cat('Groceries'), source: 'learned' });
    await json('POST', '/api/transactions/undo-learn', { cookie: s.cookie, body: { ruleId: r.body.learned.ruleId, txIds: r.body.learned.txIds, previous: r.body.learned.previous } });
    const rule = await DB.prepare('SELECT category_id FROM category_rules WHERE id = ?1').bind(r.body.learned.ruleId).first<{ category_id: string }>();
    expect(rule!.category_id).toBe(s.cat('Groceries'));
  });

  it('an existing member accepting an owner invite is promoted; a viewer link never demotes', async () => {
    const o = await ownerSetup();
    const u = await makeUser('Existing');
    await addMember(o.householdId, u, 'viewer');
    const cookie = await sessionFor(u, o.householdId);
    const { token } = await makeInvite({ kind: 'owner', householdId: o.householdId, role: 'owner' });
    expect((await json('POST', '/api/invites/accept', { cookie, body: { token } })).status).toBe(200);
    expect((await DB.prepare('SELECT role FROM memberships WHERE household_id = ?1 AND user_id = ?2').bind(o.householdId, u).first<{ role: string }>())!.role).toBe('owner');
    const v = await makeInvite({ kind: 'member', householdId: o.householdId, role: 'viewer' });
    await json('POST', '/api/invites/accept', { cookie, body: { token: v.token } });
    expect((await DB.prepare('SELECT role FROM memberships WHERE household_id = ?1 AND user_id = ?2').bind(o.householdId, u).first<{ role: string }>())!.role).toBe('owner');
  });

  it('the database allows only one super-admin', async () => {
    await makeUser('Admin', true);
    await expect(DB.prepare("INSERT INTO users (id, display_name, is_super_admin, created_at) VALUES ('sa2', 'Second', 1, 'x')").run()).rejects.toThrow();
  });
});
