import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { addMonths, monthEnd, monthOf, monthStart, todayInTz } from '../../src/shared/dates';
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
    const d = await json<{ points: { cumulativeMinor: number | null; prevCumulativeMinor: number }[] }>('GET', `/api/trends/daily?month=${prev}`, { cookie: o.cookie });
    expect(d.body.points.length).toBeGreaterThanOrEqual(28);
    expect(d.body.points.at(-1)!.prevCumulativeMinor).toBeGreaterThan(0);
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

  it('trends: from/to range drives categories, buckets and months; bad ranges are rejected', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const cur = monthOf(todayInTz('Asia/Jerusalem'));
    const [m1, m3] = [addMonths(cur, -1), addMonths(cur, -3)];
    type Daily = { granularity: string; points: { start: string; spentMinor: number; cumulativeMinor: number | null; prevCumulativeMinor: number }[] };
    // one month = the same as ?month=, day buckets
    const byMonth = await json<Daily>('GET', `/api/trends/daily?month=${m1}`, { cookie: o.cookie });
    const byRange = await json<Daily>('GET', `/api/trends/daily?from=${monthStart(m1)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(byRange.body).toEqual(byMonth.body);
    expect(byRange.body.granularity).toBe('day');
    // three whole months: weekly buckets, cumulative ends at the period total
    const q = await json<Daily>('GET', `/api/trends/daily?from=${monthStart(m3)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(q.body.granularity).toBe('week');
    expect(q.body.points[0]!.start).toBe(monthStart(m3));
    const sum = q.body.points.reduce((a, p) => a + p.spentMinor, 0);
    expect(q.body.points.at(-1)!.cumulativeMinor).toBe(sum);
    const cats = await json<{ totalMinor: number }>('GET', `/api/trends/categories?from=${monthStart(m3)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(cats.body.totalMinor).toBe(sum);
    // a year: monthly buckets; over-months covers the months spanned
    expect((await json<Daily>('GET', `/api/trends/daily?from=${monthStart(addMonths(cur, -11))}&to=${monthEnd(cur)}`, { cookie: o.cookie })).body.granularity).toBe('month');
    const m = await json<{ points: { month: string }[] }>('GET', `/api/trends/monthly?from=${monthStart(m3)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(m.body.points.map((p) => p.month)).toEqual([m3, addMonths(m3, 1), m1]);
    // validation
    for (const qs of [`from=${monthStart(m1)}`, `from=${monthEnd(m1)}&to=${monthStart(m1)}`, 'from=2020-01-01&to=2026-01-01', 'from=2026-02-30&to=2026-03-01'])
      expect((await json('GET', `/api/trends/daily?${qs}`, { cookie: o.cookie })).status).toBe(400);
    expect((await json('GET', `/api/trends/monthly?from=${monthEnd(m1)}&to=${monthStart(m1)}`, { cookie: o.cookie })).status).toBe(400);
  });
});
