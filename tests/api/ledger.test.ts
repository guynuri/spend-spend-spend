import { describe, expect, it } from 'vitest';
import { DB, addMember, call, json, makeUser, ownerSetup, sessionFor } from './helpers';
import type { Category, Tx, TxList } from '../../src/shared/schemas/ledger';

async function setup() {
  const o = await ownerSetup();
  const acc = await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Checking', type: 'checking', openingBalanceMinor: 100000, openingDate: '2026-01-01' } });
  const cats = (await json<{ categories: Category[] }>('GET', '/api/categories', { cookie: o.cookie })).body.categories;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const add = async (date: string, amountMinor: number, description: string, extra: Record<string, unknown> = {}) =>
    (await json<Tx>('POST', '/api/transactions', { cookie: o.cookie, body: { date, amountMinor: Math.abs(amountMinor), direction: amountMinor < 0 ? 'out' : 'in', description, accountId: acc.body.id, ...extra } })).body;
  return { ...o, accountId: acc.body.id, cats, cat, add };
}

describe('accounts (AC3.1)', () => {
  it('create, edit, balance snapshot, variance, archive when used', async () => {
    const s = await setup();
    await s.add('2026-02-01', -2500, 'Coffee');
    let list = (await json<{ accounts: { id: string; balanceMinor: number; varianceMinor: number | null }[] }>('GET', '/api/accounts', { cookie: s.cookie })).body.accounts;
    expect(list[0]!.balanceMinor).toBe(97500);
    expect((await json('POST', `/api/accounts/${s.accountId}/balance`, { cookie: s.cookie, body: { date: '2026-02-10', balanceMinor: 97000 } })).status).toBe(200);
    list = (await json<{ accounts: { id: string; balanceMinor: number; varianceMinor: number | null }[] }>('GET', '/api/accounts', { cookie: s.cookie })).body.accounts;
    expect(list[0]!.balanceMinor).toBe(97000);
    expect(list[0]!.varianceMinor).toBe(-500);
    expect((await json('PATCH', `/api/accounts/${s.accountId}`, { cookie: s.cookie, body: { name: 'Main', includeInForecast: false } })).status).toBe(200);
    expect((await json<{ archived: boolean }>('DELETE', `/api/accounts/${s.accountId}`, { cookie: s.cookie })).body.archived).toBe(true);
    const unused = await json<{ id: string }>('POST', '/api/accounts', { cookie: s.cookie, body: { name: 'Cash', type: 'cash' } });
    expect((await json<{ deleted: boolean }>('DELETE', `/api/accounts/${unused.body.id}`, { cookie: s.cookie })).body.deleted).toBe(true);
  });
});

describe('categories (AC3.2)', () => {
  it('defaults exist; add, rename, regroup; in-use is archived, unused deleted, system kept', async () => {
    const s = await setup();
    expect(s.cats.length).toBeGreaterThanOrEqual(28);
    expect(s.cats.find((c) => c.systemKey === 'card_unsplit')).toBeTruthy();
    const rules = (await json<{ rules: unknown[] }>('GET', '/api/rules', { cookie: s.cookie })).body.rules;
    expect(rules.length).toBeGreaterThanOrEqual(30);
    const c1 = await json<{ id: string }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Pets', kind: 'expense', grp: 'variable' } });
    expect(c1.status).toBe(201);
    expect((await json('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Pets', kind: 'expense' } })).status).toBe(409);
    expect((await json('PATCH', `/api/categories/${c1.body.id}`, { cookie: s.cookie, body: { name: 'Pet care', grp: 'fixed' } })).status).toBe(200);
    await s.add('2026-02-02', -1000, 'Vet', { categoryId: c1.body.id });
    expect((await json<{ archived: boolean }>('DELETE', `/api/categories/${c1.body.id}`, { cookie: s.cookie })).body.archived).toBe(true);
    const c2 = await json<{ id: string }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Unused', kind: 'expense' } });
    expect((await json<{ deleted: boolean }>('DELETE', `/api/categories/${c2.body.id}`, { cookie: s.cookie })).body.deleted).toBe(true);
    expect((await json('DELETE', `/api/categories/${s.cats.find((c) => c.systemKey === 'card_unsplit')!.id}`, { cookie: s.cookie })).status).toBe(409);
  });
});

describe('transactions, rules, learning (AC3.3, AC3.5)', () => {
  it('seed rules categorize; card lumps are flagged', async () => {
    const s = await setup();
    const t1 = await s.add('2026-02-03', -12000, 'שופרסל דיל 1234');
    expect(t1.categoryId).toBe(s.cat('Groceries'));
    expect(t1.categorySource).toBe('rule');
    const t2 = await s.add('2026-02-10', -650000, 'ישראכרט חיוב');
    expect(t2.kind).toBe('card_lump');
    expect(t2.categoryId).toBe(s.cat('Credit card (not split)'));
    const t3 = await s.add('2026-02-01', 1500000, 'משכורת');
    expect(t3.categoryId).toBe(s.cat('Salary'));
  });

  it('user rule beats seed rule; longer pattern wins within a source', async () => {
    const s = await setup();
    await json('POST', '/api/rules', { cookie: s.cookie, body: { field: 'description', match: 'contains', pattern: 'שופרסל', sign: 'out', categoryId: s.cat('Home') } });
    expect((await s.add('2026-02-03', -5000, 'שופרסל אונליין')).categoryId).toBe(s.cat('Home'));
    await json('POST', '/api/rules', { cookie: s.cookie, body: { field: 'description', match: 'contains', pattern: 'שופרסל אונליין', sign: 'out', categoryId: s.cat('Groceries') } });
    expect((await s.add('2026-02-04', -5000, 'שופרסל אונליין')).categoryId).toBe(s.cat('Groceries'));
  });

  it('manual categorization learns a rule, applies it to matches, and can be undone', async () => {
    const s = await setup();
    const a = await s.add('2026-02-05', -3000, 'Pizza Napoli 5555');
    const b = await s.add('2026-02-12', -4000, 'Pizza  Napoli 6666');
    const c = await s.add('2026-02-13', 4000, 'Pizza Napoli');
    expect(a.categoryId).toBeNull();
    const r = await json<{ tx: Tx; learned: { ruleId: string; count: number; txIds: string[] } }>('PATCH', `/api/transactions/${a.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Eating out') } });
    expect(r.body.tx.categorySource).toBe('user');
    expect(r.body.learned.count).toBe(1);
    expect(r.body.learned.txIds).toEqual([b.id]);
    const cRow = await DB.prepare('SELECT category_id FROM transactions WHERE id = ?1').bind(c.id).first<{ category_id: string | null }>();
    expect(cRow!.category_id).toBeNull(); // different sign
    const later = await s.add('2026-02-20', -3500, 'PIZZA NAPOLI');
    expect(later.categoryId).toBe(s.cat('Eating out'));
    expect((await json('POST', '/api/transactions/undo-learn', { cookie: s.cookie, body: { ruleId: r.body.learned.ruleId, txIds: r.body.learned.txIds } })).status).toBe(200);
    const bRow = await DB.prepare('SELECT category_id FROM transactions WHERE id = ?1').bind(b.id).first<{ category_id: string | null }>();
    expect(bRow!.category_id).toBeNull();
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM category_rules WHERE id = ?1').bind(r.body.learned.ruleId).first<{ n: number }>())!.n).toBe(0);
  });

  it('rules never overwrite a user category', async () => {
    const s = await setup();
    const t = await s.add('2026-02-03', -100, 'רמי לוי', { categoryId: s.cat('Kids') });
    await json('POST', '/api/rules/apply', { cookie: s.cookie });
    expect((await DB.prepare('SELECT category_id FROM transactions WHERE id = ?1').bind(t.id).first<{ category_id: string }>())!.category_id).toBe(s.cat('Kids'));
  });

  it('imported fields are read-only; manual edits allowed', async () => {
    const s = await setup();
    const t = await s.add('2026-02-03', -100, 'X');
    expect((await json<{ tx: Tx }>('PATCH', `/api/transactions/${t.id}`, { cookie: s.cookie, body: { amountMinor: 250, direction: 'out', notes: 'n' } })).body.tx.amountMinor).toBe(-250);
    await DB.prepare("UPDATE transactions SET source = 'import' WHERE id = ?1").bind(t.id).run();
    expect((await json<{ error: { code: string } }>('PATCH', `/api/transactions/${t.id}`, { cookie: s.cookie, body: { amountMinor: 1, direction: 'out' } })).body.error.code).toBe('imported_readonly');
  });
});

describe('ledger list (AC3.4)', () => {
  it('filters, search normalization, cursor pagination of 50', async () => {
    const s = await setup();
    const stmts = [];
    for (let i = 0; i < 60; i++) {
      const id = `bulk${String(i).padStart(3, '0')}`;
      stmts.push(
        DB.prepare("INSERT INTO transactions (id, household_id, account_id, date, amount_minor, description, description_norm, dedupe_key, source, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, -100, 'Row', 'row', ?1, 'manual', 'x', 'x')").bind(
          id,
          s.householdId,
          s.accountId,
          `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
        ),
      );
    }
    await DB.batch(stmts);
    const p1 = await json<TxList>('GET', '/api/transactions?from=2026-03-01&to=2026-03-31', { cookie: s.cookie });
    expect(p1.body.items).toHaveLength(50);
    expect(p1.body.summary.count).toBe(60);
    const p2 = await json<TxList>('GET', `/api/transactions?from=2026-03-01&to=2026-03-31&cursor=${p1.body.nextCursor}`, { cookie: s.cookie });
    expect(p2.body.items).toHaveLength(10);
    expect(p2.body.nextCursor).toBeNull();
    expect(new Set([...p1.body.items, ...p2.body.items].map((t) => t.id)).size).toBe(60);
    await s.add('2026-03-05', -999, 'בית קפה ״השכונה״');
    for (const q of ['קָפֶה "השכונה"', '  בית   קפה ', 'השכונה”', 'ROW']) {
      const r = await json<TxList>('GET', `/api/transactions?from=2026-03-01&to=2026-03-31&q=${encodeURIComponent(q)}`, { cookie: s.cookie });
      expect(r.body.summary.count, q).toBeGreaterThan(0);
    }
    const unc = await json<TxList>('GET', '/api/transactions?from=2026-03-01&to=2026-03-31&uncategorized=1', { cookie: s.cookie });
    expect(unc.body.summary.count).toBe(61);
    const none = await json<TxList>('GET', `/api/transactions?from=2026-03-01&to=2026-03-31&account=nope`, { cookie: s.cookie });
    expect(none.body.summary.count).toBe(0);
  });
});

describe('splits (AC3.6) and bulk/export (AC3.7)', () => {
  it('rejects mismatched sums; same-as-last-time scales; budget lines via v_lines', async () => {
    const s = await setup();
    const t1 = await s.add('2026-01-10', -700000, 'כאל חיוב');
    const bad = await json<{ error: { code: string } }>('PUT', `/api/transactions/${t1.id}/splits`, { cookie: s.cookie, body: { lines: [{ categoryId: s.cat('Groceries'), amountMinor: -400000 }, { categoryId: s.cat('Leisure'), amountMinor: -200000 }] } });
    expect(bad.body.error.code).toBe('split_sum_mismatch');
    const ok = await json('PUT', `/api/transactions/${t1.id}/splits`, { cookie: s.cookie, body: { lines: [{ categoryId: s.cat('Groceries'), amountMinor: -400000 }, { categoryId: s.cat('Leisure'), amountMinor: -300000 }] } });
    expect(ok.status).toBe(200);
    const t2 = await s.add('2026-02-10', -800001, 'כאל חיוב');
    const sug = await json<{ suggestion: { lines: { amountMinor: number }[] } }>('GET', `/api/transactions/${t2.id}/split-suggestion`, { cookie: s.cookie });
    const lines = sug.body.suggestion.lines;
    expect(lines.reduce((a, l) => a + l.amountMinor, 0)).toBe(-800001);
    expect(lines[0]!.amountMinor).toBe(-457143);
    expect(lines[1]!.amountMinor).toBe(-342858);
    const lineRows = await DB.prepare('SELECT COUNT(*) AS n, SUM(amount_minor) AS s FROM v_lines WHERE household_id = ?1 AND tx_id = ?2').bind(s.householdId, t1.id).first<{ n: number; s: number }>();
    expect(lineRows).toEqual({ n: 2, s: -700000 });
  });

  it('bulk sets a category; CSV export has BOM and neutralizes formulas', async () => {
    const s = await setup();
    const a = await s.add('2026-04-01', -100, '=HYPERLINK("x")');
    const b = await s.add('2026-04-02', -200, 'Plain, with comma');
    expect((await json<{ updated: number }>('POST', '/api/transactions/bulk', { cookie: s.cookie, body: { ids: [a.id, b.id], categoryId: s.cat('Home') } })).body.updated).toBe(2);
    const res = await call('GET', '/api/transactions/export.csv?from=2026-04-01&to=2026-04-30', { cookie: s.cookie });
    expect(res.headers.get('content-type')).toContain('text/csv');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(buf);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain('"Plain, with comma"');
    expect(text).toContain('-2.00');
  });
});

describe('roles on ledger routes (AC1.5)', () => {
  it('viewer can read but every write is forbidden_role', async () => {
    const s = await setup();
    const v = await makeUser('V');
    await addMember(s.householdId, v, 'viewer');
    const vc = await sessionFor(v, s.householdId);
    expect((await json('GET', '/api/transactions', { cookie: vc })).status).toBe(200);
    for (const [m, p, body] of [
      ['POST', '/api/transactions', { date: '2026-01-01', amountMinor: 1, direction: 'out', description: 'x', accountId: s.accountId }],
      ['POST', '/api/accounts', { name: 'x', type: 'cash' }],
      ['POST', '/api/categories', { name: 'x', kind: 'expense' }],
      ['POST', '/api/rules/apply', {}],
    ] as const) {
      const r = await json<{ error: { code: string } }>(m, p, { cookie: vc, body });
      expect(r.body.error.code, p).toBe('forbidden_role');
    }
  });
});
