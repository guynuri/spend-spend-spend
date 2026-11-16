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
  it('bank from the catalog or free text; unknown bank ids rejected', async () => {
    const s = await setup();
    type L = { accounts: { id: string; bankId: string | null; institution: string | null }[] };
    const get = async () => (await json<L>('GET', '/api/accounts', { cookie: s.cookie })).body.accounts.find((a) => a.id === s.accountId)!;
    expect(await get()).toMatchObject({ bankId: null, institution: null });
    expect((await json('PATCH', `/api/accounts/${s.accountId}`, { cookie: s.cookie, body: { bankId: 'leumi', institution: '' } })).status).toBe(200);
    expect(await get()).toMatchObject({ bankId: 'leumi' });
    expect((await json('PATCH', `/api/accounts/${s.accountId}`, { cookie: s.cookie, body: { bankId: null, institution: 'My credit union' } })).status).toBe(200);
    expect(await get()).toMatchObject({ bankId: null, institution: 'My credit union' });
    expect((await json('PATCH', `/api/accounts/${s.accountId}`, { cookie: s.cookie, body: { bankId: 'nope' } })).status).toBe(400);
  });
});

describe('categories (AC3.2)', () => {
  it('defaults exist; add, rename, regroup; in-use is archived, unused deleted, system kept', async () => {
    const s = await setup();
    expect(s.cats.length).toBe(19);
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

  it('catalog: short core set, one-tap add with built-in rules, hide unused keeps used ones; hidden categories get no rule hits', async () => {
    const s = await setup();
    expect(s.cats.some((c) => c.name === 'Cash withdrawals')).toBe(false);
    const sug = (await json<{ suggestions: { key: string; en: string }[] }>('GET', '/api/categories/suggestions', { cookie: s.cookie })).body.suggestions;
    expect(sug.map((x) => x.key)).toContain('cash');
    expect(sug.some((x) => x.key === 'groceries' || x.key === 'transfers')).toBe(false);
    const add = await json<{ id: string }>('POST', '/api/categories/suggestions/cash', { cookie: s.cookie, headers: { 'x-mz-locale': 'en' } });
    expect(add.status).toBe(201);
    expect((await s.add('2026-02-04', -20000, 'משיכת מזומן')).categoryId).toBe(add.body.id);
    expect((await json('POST', '/api/categories/suggestions/nope', { cookie: s.cookie })).status).toBe(404);
    const g = s.cat('Groceries');
    await s.add('2026-02-05', -5000, 'שופרסל');
    // one month of history is not enough to call anything unused
    expect((await json<{ eligible: boolean }>('GET', '/api/categories/hide-unused', { cookie: s.cookie })).body.eligible).toBe(false);
    expect((await json<{ error: { code: string } }>('POST', '/api/categories/hide-unused', { cookie: s.cookie, body: { ids: [g] } })).body.error.code).toBe('no_history');
    await s.add('2026-03-01', -3000, 'שופרסל');
    const pre = (await json<{ eligible: boolean; candidates: { id: string; name: string }[] }>('GET', '/api/categories/hide-unused', { cookie: s.cookie })).body;
    expect(pre.eligible).toBe(true);
    const ids = pre.candidates.map((c) => c.id);
    expect(ids).not.toContain(g);
    expect(ids).not.toContain(add.body.id);
    const salary = s.cat('Salary');
    expect(ids).toContain(salary);
    // the user keeps Salary; a used id sent anyway is re-validated and left alone
    const hid = await json<{ hidden: number }>('POST', '/api/categories/hide-unused', { cookie: s.cookie, body: { ids: [...ids.filter((x) => x !== salary), g] } });
    expect(hid.body.hidden).toBe(ids.length - 1);
    const after = (await json<{ categories: Category[] }>('GET', '/api/categories', { cookie: s.cookie })).body.categories;
    const byId = new Map(after.map((c) => [c.id, c]));
    expect(byId.get(g)!.archived).toBe(false);
    expect(byId.get(add.body.id)!.archived).toBe(false);
    expect(after.filter((c) => c.systemKey).every((c) => !c.archived)).toBe(true);
    expect(byId.get(salary)!.archived).toBe(false);
    const phone = byId.get(s.cat('Phone & internet'))!;
    expect(phone.archived).toBe(true);
    expect((await s.add('2026-02-06', -9000, 'בזק')).categoryId).toBeNull();
    // re-adding a hidden default restores it
    expect((await json<{ id: string }>('POST', '/api/categories/suggestions/phone', { cookie: s.cookie })).body.id).toBe(phone.id);
  });

  it('hide unused is refused before any transaction; old default names still match; custom name of a hidden category restores it', async () => {
    const s = await setup();
    expect((await json<{ eligible: boolean; candidates: unknown[] }>('GET', '/api/categories/hide-unused', { cookie: s.cookie })).body).toEqual({ eligible: false, candidates: [] });
    const loans = s.cat('Loan repayments');
    expect((await json('PATCH', `/api/categories/${loans}`, { cookie: s.cookie, body: { name: 'Loans' } })).status).toBe(200);
    const sug = (await json<{ suggestions: { key: string }[] }>('GET', '/api/categories/suggestions', { cookie: s.cookie })).body.suggestions;
    expect(sug.some((x) => x.key === 'loans')).toBe(false);
    expect((await json<{ id: string }>('POST', '/api/categories/suggestions/loans', { cookie: s.cookie })).body.id).toBe(loans);
    const c = await json<{ id: string }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Hobby', kind: 'expense' } });
    expect((await json('PATCH', `/api/categories/${c.body.id}`, { cookie: s.cookie, body: { archived: true } })).status).toBe(200);
    const again = await json<{ id: string }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Hobby', kind: 'expense' } });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(c.body.id);
    expect((await json('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Hobby', kind: 'expense' } })).status).toBe(409);
    // a hidden category of another kind is not restored for a different kind
    const inc = await json<{ id: string }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Bonus', kind: 'income' } });
    await json('PATCH', `/api/categories/${inc.body.id}`, { cookie: s.cookie, body: { archived: true } });
    expect((await json<{ error: { code: string } }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Bonus', kind: 'expense' } })).body.error.code).toBe('name_taken_hidden');
    // alias lookup is kind-aware: an income "Loans" is not taken for the expense default
    await json('PATCH', `/api/categories/${loans}`, { cookie: s.cookie, body: { name: 'Old loans' } });
    const incLoans = await json<{ id: string }>('POST', '/api/categories', { cookie: s.cookie, body: { name: 'Loans', kind: 'income' } });
    const added = await json<{ id: string }>('POST', '/api/categories/suggestions/loans', { cookie: s.cookie, headers: { 'x-mz-locale': 'en' } });
    expect(added.status).toBe(201);
    expect(added.body.id).not.toBe(incLoans.body.id);
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

  it('manual categorization changes only that transaction and offers similar ones (Task 10)', async () => {
    const s = await setup();
    const a = await s.add('2026-02-05', -3000, 'Pizza Napoli 5555');
    const b = await s.add('2026-02-12', -4000, 'Pizza  Napoli 6666');
    await s.add('2026-02-13', 4000, 'Pizza Napoli'); // different sign: not similar
    const r = await json<{ tx: Tx; learned: unknown; similar: { count: number; txIds: string[] } }>('PATCH', `/api/transactions/${a.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Eating out') } });
    expect(r.body.tx.categorySource).toBe('user');
    expect(r.body.learned).toBeNull();
    expect(r.body.similar).toEqual({ count: 1, txIds: [b.id] });
    expect((await DB.prepare('SELECT category_id FROM transactions WHERE id = ?1').bind(b.id).first<{ category_id: string | null }>())!.category_id).toBeNull();
    expect((await DB.prepare("SELECT COUNT(*) AS n FROM category_rules WHERE household_id = (SELECT household_id FROM transactions WHERE id = ?1) AND source = 'learned'").bind(a.id).first<{ n: number }>())!.n).toBe(0);
    expect((await s.add('2026-02-20', -3500, 'PIZZA NAPOLI')).categoryId).toBeNull();
  });

  it('payment apps, transfers and checks are never offered as similar nor learned', async () => {
    const s = await setup();
    const a = await s.add('2026-02-05', -3000, 'העברה בביט');
    await s.add('2026-02-06', -2000, 'העברה בביט');
    for (const learn of [false, true]) {
      const r = await json<{ learned: unknown; similar: unknown }>('PATCH', `/api/transactions/${a.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Eating out'), learn } });
      expect(r.body).toMatchObject({ learned: null, similar: null });
    }
    expect((await json<TxList>('GET', '/api/transactions?from=2026-02-01&to=2026-02-28&uncategorized=1', { cookie: s.cookie })).body.summary.count).toBe(1);
  });

  it('"always for this merchant" (learn: true) learns a rule, applies it to matches, and can be undone', async () => {
    const s = await setup();
    const a = await s.add('2026-02-05', -3000, 'Pizza Napoli 5555');
    const b = await s.add('2026-02-12', -4000, 'Pizza  Napoli 6666');
    const c = await s.add('2026-02-13', 4000, 'Pizza Napoli');
    expect(a.categoryId).toBeNull();
    const r = await json<{ tx: Tx; learned: { ruleId: string; count: number; txIds: string[] } }>('PATCH', `/api/transactions/${a.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Eating out'), learn: true } });
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

  it('"always" never re-points an explicit user rule; undo restores a re-pointed learned rule', async () => {
    const s = await setup();
    await json('POST', '/api/rules', { cookie: s.cookie, body: { field: 'description', match: 'equals', pattern: 'Corner Deli', sign: 'out', categoryId: s.cat('Home') } });
    const a = await s.add('2026-02-05', -300, 'Corner Deli');
    expect(a.categoryId).toBe(s.cat('Home'));
    const r = await json<{ tx: Tx; learned: unknown }>('PATCH', `/api/transactions/${a.id}`, { cookie: s.cookie, body: { categoryId: s.cat('Eating out'), learn: true } });
    expect(r.body.tx.categoryId).toBe(s.cat('Eating out'));
    expect(r.body.learned).toBeNull();
    const rule = await DB.prepare("SELECT category_id, source FROM category_rules WHERE household_id = ?1 AND pattern_norm = 'corner deli'").bind(s.householdId).first<{ category_id: string; source: string }>();
    expect(rule).toEqual({ category_id: s.cat('Home'), source: 'user' });
  });

  it('category search ignores the old category of a split transaction', async () => {
    const s = await setup();
    const t = await s.add('2026-02-07', -1000, 'Split Me', { categoryId: s.cat('Groceries') });
    await json('PUT', `/api/transactions/${t.id}/splits`, { cookie: s.cookie, body: { lines: [{ categoryId: s.cat('Home'), amountMinor: -600 }, { categoryId: s.cat('Eating out'), amountMinor: -400 }] } });
    const q = (x: string) => json<TxList>('GET', `/api/transactions?from=2026-02-01&to=2026-02-28&q=${encodeURIComponent(x)}`, { cookie: s.cookie });
    expect((await q('groceries')).body.items.map((i) => i.id)).not.toContain(t.id);
    expect((await q('eating')).body.items.map((i) => i.id)).toContain(t.id);
  });

  it('rule lookup for statement rows returns the winning category or null', async () => {
    const s = await setup();
    const r = await json<{ categoryIds: (string | null)[] }>('POST', '/api/rules/match', { cookie: s.cookie, body: { items: [{ description: 'שופרסל דיל 1234', amountMinor: -500 }, { description: 'Unknown Shop', amountMinor: -100 }] } });
    expect(r.body.categoryIds).toEqual([s.cat('Groceries'), null]);
  });

  it('rules never overwrite a user category', async () => {
    const s = await setup();
    const t = await s.add('2026-02-03', -100, 'רמי לוי', { categoryId: s.cat('Leisure') });
    await json('POST', '/api/rules/apply', { cookie: s.cookie });
    expect((await DB.prepare('SELECT category_id FROM transactions WHERE id = ?1').bind(t.id).first<{ category_id: string }>())!.category_id).toBe(s.cat('Leisure'));
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
  it('lists a just-added row first within its day; description is optional', async () => {
    const s = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await s.add('2026-04-10', -100 - i, i === 4 ? '' : `Same day ${i}`)).id);
    const r = await json<TxList>('GET', '/api/transactions?from=2026-04-01&to=2026-04-30', { cookie: s.cookie });
    expect(r.body.items.map((t) => t.id)).toEqual([...ids].reverse());
    expect(r.body.items[0]!.description).toBe('');
  });
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
    // Search matches category names, including a default category's name in the other language.
    const g = await s.add('2026-03-06', -500, 'Corner 77', { categoryId: s.cat('Groceries') });
    for (const q of ['grocer', 'מכולת']) {
      const r = await json<TxList>('GET', `/api/transactions?from=2026-03-01&to=2026-03-31&q=${encodeURIComponent(q)}`, { cookie: s.cookie });
      expect(r.body.items.map((t) => t.id), q).toEqual([g.id]);
    }
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

  it('no split suggestion for a description-less transaction', async () => {
    const s = await setup();
    const t1 = await s.add('2026-01-10', -1000, '');
    await json('PUT', `/api/transactions/${t1.id}/splits`, { cookie: s.cookie, body: { lines: [{ categoryId: s.cat('Groceries'), amountMinor: -600 }, { categoryId: s.cat('Leisure'), amountMinor: -400 }] } });
    const t2 = await s.add('2026-02-10', -2000, '');
    const sug = await json<{ suggestion: unknown }>('GET', `/api/transactions/${t2.id}/split-suggestion`, { cookie: s.cookie });
    expect(sug.body.suggestion).toBeNull();
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
