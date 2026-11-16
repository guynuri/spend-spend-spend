import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { addMonths, monthOf, todayInTz } from '../../src/shared/dates';
import type { BudgetView } from '../../src/shared/domain/budget';

describe('budgets & trends (AC5.1–5.5, AC10.1)', () => {
  it('budget view from demo data; edits apply from M on; unsplit card banner amount; dashboard parity later', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const today = todayInTz('Asia/Jerusalem');
    const cur = monthOf(today);
    const prev = addMonths(cur, -1);
    const v = await json<BudgetView & { history: unknown[]; categoryHistory: Record<string, unknown[]> }>('GET', `/api/budgets?month=${prev}`, { cookie: o.cookie });
    expect(v.status).toBe(200);
    expect(v.body.f).toBe(1);
    expect(v.body.lines.filter((l) => l.limitMinor !== null)).toHaveLength(12);
    expect(v.body.totals.budgetedMinor).toBeGreaterThan(0);
    expect(v.body.history).toHaveLength(6);
    expect(v.body.allocation.avgIncomeMinor).toBeGreaterThan(2000000);
    const groceries = v.body.lines.find((l) => l.name === 'Groceries')!;
    expect(groceries.avg3Minor).toBeGreaterThan(0);
    // change Groceries from the current month on: previous month keeps its value
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: cur, items: [{ categoryId: groceries.categoryId, limitMinor: 1 }] } })).status).toBe(200);
    const after = await json<BudgetView>('GET', `/api/budgets?month=${prev}`, { cookie: o.cookie });
    expect(after.body.lines.find((l) => l.name === 'Groceries')!.limitMinor).toBe(groceries.limitMinor);
    const now = await json<BudgetView>('GET', `/api/budgets?month=${cur}`, { cookie: o.cookie });
    expect(now.body.lines.find((l) => l.name === 'Groceries')!.limitMinor).toBe(1);
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: cur, items: [{ categoryId: groceries.categoryId, limitMinor: null }] } })).status).toBe(200);
    expect((await json<BudgetView>('GET', `/api/budgets?month=${cur}`, { cookie: o.cookie })).body.lines.find((l) => l.name === 'Groceries')!.limitMinor).toBeNull();
    // one-time limit: this month only, wins over the recurring one, removable; health still computes
    const lineIn = async (m: string) => (await json<BudgetView>('GET', `/api/budgets?month=${m}`, { cookie: o.cookie })).body.lines.find((l) => l.name === 'Groceries')!;
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: prev, items: [{ categoryId: groceries.categoryId, limitMinor: 777, oneTime: true }] } })).status).toBe(200);
    expect(await lineIn(prev)).toMatchObject({ limitMinor: 777, oneTime: true });
    expect((await lineIn(addMonths(prev, -1))).limitMinor).toBe(groceries.limitMinor);
    expect((await json('GET', '/api/dashboard', { cookie: o.cookie })).status).toBe(200);
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: prev, items: [{ categoryId: groceries.categoryId, limitMinor: null, oneTime: true }] } })).status).toBe(200);
    expect(await lineIn(prev)).toMatchObject({ limitMinor: groceries.limitMinor, oneTime: false });
    // a recurring save in M replaces that month's one-time limit
    await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: prev, items: [{ categoryId: groceries.categoryId, limitMinor: 5, oneTime: true }] } });
    await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: prev, items: [{ categoryId: groceries.categoryId, limitMinor: groceries.limitMinor }] } });
    expect(await lineIn(prev)).toMatchObject({ limitMinor: groceries.limitMinor, oneTime: false });
    // the latest card lump is unsplit
    const lumpMonth = Number(today.slice(8)) > 10 ? cur : prev;
    expect((await json<BudgetView>('GET', `/api/budgets?month=${lumpMonth}`, { cookie: o.cookie })).body.unsplitCardMinor).toBeGreaterThan(600000);
    // income category cannot be budgeted
    const cats = (await json<{ categories: { id: string; kind: string }[] }>('GET', '/api/categories', { cookie: o.cookie })).body.categories;
    const inc = cats.find((c) => c.kind === 'income')!;
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: cur, items: [{ categoryId: inc.id, limitMinor: 5 }] } })).status).toBe(400);
  });

  it('trends: categories share, daily cumulative vs previous month, 12 months P&L and one category', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const prev = addMonths(monthOf(todayInTz('Asia/Jerusalem')), -1);
    const c = await json<{ totalMinor: number; items: { share: number; spentMinor: number; categoryId: string | null }[] }>('GET', `/api/trends/categories?month=${prev}`, { cookie: o.cookie });
    expect(c.body.items.reduce((a, i) => a + i.share, 0)).toBeCloseTo(1);
    expect(c.body.items.reduce((a, i) => a + i.spentMinor, 0)).toBe(c.body.totalMinor);
    const d = await json<{ days: { cumulativeMinor: number | null; prevCumulativeMinor: number }[] }>('GET', `/api/trends/daily?month=${prev}`, { cookie: o.cookie });
    expect(d.body.days.length).toBeGreaterThanOrEqual(28);
    expect(d.body.days.at(-1)!.prevCumulativeMinor).toBeGreaterThan(0);
    const m = await json<{ points: { incomeMinor: number; expensesMinor: number; netMinor: number }[] }>('GET', '/api/trends/monthly?months=12', { cookie: o.cookie });
    expect(m.body.points).toHaveLength(12);
    expect(m.body.points.every((p) => p.netMinor === p.incomeMinor - p.expensesMinor)).toBe(true);
    const cid = c.body.items.find((i) => i.categoryId)!.categoryId!;
    const one = await json<{ points: { spentMinor: number }[] }>('GET', `/api/trends/monthly?months=12&category=${cid}`, { cookie: o.cookie });
    expect(one.body.points.some((p) => p.spentMinor > 0)).toBe(true);
    // budget "expenses" equals the trends total for the same month (one definition)
    const b = await json<BudgetView>('GET', `/api/budgets?month=${prev}`, { cookie: o.cookie });
    expect(b.body.totals.expensesMinor).toBe(c.body.totalMinor);
  });
});
