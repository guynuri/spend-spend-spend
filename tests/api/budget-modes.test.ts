import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { addMonths, monthOf, todayInTz } from '../../src/shared/dates';
import { GENERAL_ID, type BudgetView } from '../../src/shared/domain/budget';
import type { ReviewSnapshot } from '../../src/shared/domain/review';
import type { UsualMonth } from '../../src/shared/domain/usual';
import type { Category } from '../../src/shared/schemas/ledger';

describe('budget modes: general expenses and occasional categories', () => {
  it('pools general categories, budgets occasional ones per year, and every page agrees', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const cur = monthOf(todayInTz('Asia/Jerusalem'));
    const m = addMonths(cur, -2); // a complete month with split card charges and no stored review
    const cats = async () => (await json<{ categories: Category[] }>('GET', '/api/categories', { cookie: o.cookie })).body.categories;
    const byName = async (n: string) => (await cats()).find((c) => c.name === n)!;

    // the sample data's Clothing comes from the catalog as a general expense; make Eating out one too
    expect((await byName('Clothing')).budgetMode).toBe('general');
    const eating = await byName('Eating out');
    expect((await json('PATCH', `/api/categories/${eating.id}`, { cookie: o.cookie, body: { budgetMode: 'general' } })).status).toBe(200);
    // system categories keep their mode
    const unsplit = (await cats()).find((c) => c.systemKey === 'card_unsplit')!;
    await json('PATCH', `/api/categories/${unsplit.id}`, { cookie: o.cookie, body: { budgetMode: 'general' } });
    expect((await byName(unsplit.name)).budgetMode).toBe('monthly');

    // an occasional category with a trip in month m
    const vac = await json<{ id: string }>('POST', '/api/categories', { cookie: o.cookie, body: { name: 'Vacation', kind: 'expense', budgetMode: 'occasional' } });
    expect(vac.status).toBe(201);
    const acc = (await json<{ accounts: { id: string; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie })).body.accounts.find((a) => a.type === 'checking')!;
    expect((await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: `${m}-12`, amountMinor: 900000, direction: 'out', description: 'Hotel Eilat', accountId: acc.id, categoryId: vac.body.id } })).status).toBe(201);

    // Budget: one general line holding both categories, with the sample data's shared limit
    const get = async (month: string) => (await json<BudgetView>('GET', `/api/budgets?month=${month}`, { cookie: o.cookie })).body;
    let v = await get(m);
    const general = v.lines.find((l) => l.categoryId === GENERAL_ID)!;
    expect(general.limitMinor).toBe(50000);
    expect(general.members!.map((x) => x.name).sort()).toEqual(['Clothing', 'Eating out']);
    expect(general.spentMinor).toBe(general.members!.reduce((a, x) => a + x.spentMinor, 0));
    expect(v.lines.some((l) => l.categoryId === eating.id)).toBe(false); // its own monthly limit is ignored while pooled
    // occasional: its own section, out of the monthly totals
    const line = v.occasional.lines.find((l) => l.categoryId === vac.body.id)!;
    expect(line).toMatchObject({ monthMinor: 900000, yearLimitMinor: null, status: null });
    expect(line.ytdMinor).toBe(900000); // January..m of m's year
    expect(v.totals.unbudgetedSpentMinor).toBe(v.totals.expensesMinor - v.totals.spentBudgetedMinor - v.occasional.totals.monthMinor);

    // budgets: general (one-time + recurring), yearly for occasional; wrong mode → 400
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ general: true, limitMinor: 1234, oneTime: true }] } })).status).toBe(200);
    expect((await get(m)).lines.find((l) => l.categoryId === GENERAL_ID)).toMatchObject({ limitMinor: 1234, oneTime: true });
    expect((await get(addMonths(m, -1))).lines.find((l) => l.categoryId === GENERAL_ID)!.limitMinor).toBe(50000);
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ general: true, limitMinor: 80000 }] } })).status).toBe(200);
    expect((await get(m)).lines.find((l) => l.categoryId === GENERAL_ID)).toMatchObject({ limitMinor: 80000, oneTime: false });
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ categoryId: vac.body.id, limitMinor: 1000000, yearly: true }] } })).status).toBe(200);
    v = await get(m);
    expect(v.occasional.lines.find((l) => l.categoryId === vac.body.id)).toMatchObject({ yearLimitMinor: 1000000, status: 'watch' }); // 90 % used
    expect((await get(`${String(Number(m.slice(0, 4)) + 1)}-06`)).occasional.lines.find((l) => l.categoryId === vac.body.id)!.yearLimitMinor).toBe(1000000); // carries to later years
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ categoryId: vac.body.id, limitMinor: 5 }] } })).body).toMatchObject({ error: { code: 'wrong_budget_mode' } });
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ categoryId: eating.id, limitMinor: 5 }] } })).status).toBe(400);
    const groceries = await byName('Groceries');
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ categoryId: groceries.id, limitMinor: 5, yearly: true }] } })).status).toBe(400);

    // Trends: general is one item with its categories; occasional is flagged; shares still add up
    type TItem = { categoryId: string | null; spentMinor: number; share: number; occasional?: boolean; members?: { categoryId: string; spentMinor: number }[] };
    const tc = (await json<{ totalMinor: number; items: TItem[] }>('GET', `/api/trends/categories?month=${m}`, { cookie: o.cookie })).body;
    expect(tc.items.reduce((a, i) => a + i.share, 0)).toBeCloseTo(1);
    expect(tc.items.reduce((a, i) => a + i.spentMinor, 0)).toBe(tc.totalMinor);
    expect(tc.items.find((i) => i.categoryId === GENERAL_ID)!.spentMinor).toBe(general.spentMinor);
    expect(tc.items.some((i) => i.categoryId === eating.id)).toBe(false);
    expect(tc.items.find((i) => i.categoryId === vac.body.id)!.occasional).toBe(true);
    const tm = (await json<{ points: { month: string; expensesMinor: number; everydayMinor: number; occasionalMinor: number }[] }>('GET', '/api/trends/monthly?months=6', { cookie: o.cookie })).body.points;
    const pm = tm.find((p) => p.month === m)!;
    expect(pm).toMatchObject({ occasionalMinor: 900000, everydayMinor: pm.expensesMinor - 900000 });
    const tg = (await json<{ points: { month: string; spentMinor: number }[] }>('GET', `/api/trends/monthly?months=6&category=${GENERAL_ID}`, { cookie: o.cookie })).body.points;
    expect(tg.find((p) => p.month === m)!.spentMinor).toBe(general.spentMinor);
    const to = (await json<{ items: { categoryId: string; yearMinor: number; quarters: number[] }[]; yearMinor: number }>('GET', `/api/trends/occasional?year=${m.slice(0, 4)}`, { cookie: o.cookie })).body;
    const q = Math.floor((Number(m.slice(5)) - 1) / 3);
    expect(to.items.find((i) => i.categoryId === vac.body.id)).toMatchObject({ yearMinor: 900000 });
    expect(to.items.find((i) => i.categoryId === vac.body.id)!.quarters[q]).toBe(900000);
    expect((await json('GET', '/api/trends/occasional?year=20x6', { cookie: o.cookie })).status).toBe(400);

    // Monthly review: split card charges count as what they bought; the trip is called out, not compared
    const r = (await json<{ snapshot: ReviewSnapshot }>('GET', `/api/reviews/${m}`, { cookie: o.cookie })).body.snapshot;
    expect(r.spending.notable.some((n) => n.via)).toBe(true);
    expect(r.spending.notable.some((n) => n.description === 'Isracard monthly charge')).toBe(false);
    expect(r.spending.occasional).toMatchObject({ minor: 900000, commentary: { key: 'review.c.occasional.this' } });
    expect(r.spending.commentary.key).toMatch(/^review\.c\.everyday\./);
    const rg = r.spending.byCategory.find((c) => c.categoryId === GENERAL_ID)!;
    expect(rg.members!.length).toBe(2);
    expect(r.spending.byCategory.find((c) => c.categoryId === vac.body.id)!.occasional).toBe(true);

    // Overview: the usual month spreads the trip over the months it has, and pools general expenses
    const u = (await json<{ usual: UsualMonth }>('GET', '/api/dashboard', { cookie: o.cookie })).body.usual;
    expect(u.occasionalMonths).toContain(m);
    expect(u.items.find((i) => i.categoryId === vac.body.id)).toMatchObject({ kind: 'occasional', avgMinor: Math.round(900000 / u.occasionalMonths.length), over: false });
    expect(u.items.find((i) => i.categoryId === GENERAL_ID)).toMatchObject({ kind: 'general' });
    expect(u.items.some((i) => i.categoryId === eating.id)).toBe(false);
  });
});
