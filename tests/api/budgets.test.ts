import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { addDays, addMonths, MAX_RANGE_DAYS, monthEnd, monthOf, monthStart, todayInTz } from '../../src/shared/dates';
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
    type Daily = { granularity: string; prevFrom: string; prevTo: string; points: { start: string; partial: boolean; spentMinor: number; cumulativeMinor: number | null; prevCumulativeMinor: number }[] };
    // one month = the same as ?month=, day buckets
    const byMonth = await json<Daily>('GET', `/api/trends/daily?month=${m1}`, { cookie: o.cookie });
    const byRange = await json<Daily>('GET', `/api/trends/daily?from=${monthStart(m1)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(byRange.body).toEqual(byMonth.body);
    expect(byRange.body.granularity).toBe('day');
    expect([byRange.body.prevFrom, byRange.body.prevTo]).toEqual([monthStart(addMonths(m1, -1)), monthEnd(addMonths(m1, -1))]);
    // three whole months: weekly buckets, cumulative ends at the period total
    const q = await json<Daily>('GET', `/api/trends/daily?from=${monthStart(m3)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(q.body.granularity).toBe('week');
    expect(q.body.points[0]!.start).toBe(monthStart(m3));
    // Sunday-start weeks; only the clipped edge weeks are partial
    const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
    expect(q.body.points.slice(1).every((p) => dow(p.start) === 0)).toBe(true);
    expect(q.body.points[0]!.partial).toBe(dow(monthStart(m3)) !== 0);
    expect(q.body.points.at(-1)!.partial).toBe(dow(monthEnd(m1)) !== 6);
    expect(q.body.points.slice(1, -1).some((p) => p.partial)).toBe(false);
    // whole months compare with the same months just before
    expect([q.body.prevFrom, q.body.prevTo]).toEqual([monthStart(addMonths(m3, -3)), monthEnd(addMonths(m1, -3))]);
    const sum = q.body.points.reduce((a, p) => a + p.spentMinor, 0);
    expect(q.body.points.at(-1)!.cumulativeMinor).toBe(sum);
    const cats = await json<{ totalMinor: number }>('GET', `/api/trends/categories?from=${monthStart(m3)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(cats.body.totalMinor).toBe(sum);
    // compare=yoy ("This year") uses the same months a year earlier; otherwise the period just before, even in January
    const prevOf = async (qs: string) => (await json<Daily>('GET', `/api/trends/daily?${qs}`, { cookie: o.cookie })).body;
    expect(await prevOf('from=2026-01-01&to=2026-11-30&compare=yoy')).toMatchObject({ prevFrom: '2025-01-01', prevTo: '2025-11-30' });
    expect(await prevOf('from=2026-01-01&to=2026-01-31')).toMatchObject({ prevFrom: '2025-12-01', prevTo: '2025-12-31' });
    expect(await prevOf('from=2026-01-01&to=2026-03-31')).toMatchObject({ prevFrom: '2025-10-01', prevTo: '2025-12-31' });
    expect((await json('GET', '/api/trends/daily?from=2026-01-01&to=2026-01-31&compare=x', { cookie: o.cookie })).status).toBe(400);
    // 40-day range from a Wednesday: previous-period weeks use the same weekday offset as the current ones
    const wed = addDays(monthStart(m1), (3 - dow(monthStart(m1)) + 7) % 7);
    const w40 = await prevOf(`from=${wed}&to=${addDays(wed, 39)}`);
    expect(w40.granularity).toBe('week');
    const spentIn = async (f: string, t: string) => (await json<{ totalMinor: number }>('GET', `/api/trends/categories?from=${f}&to=${t}`, { cookie: o.cookie })).body.totalMinor;
    for (const i of [0, 1, 2]) expect(w40.points[i]!.prevCumulativeMinor).toBe(await spentIn(w40.prevFrom, addDays(w40.prevFrom, 7 * i + 6 - 3)));
    expect(w40.points.at(-1)!.prevCumulativeMinor).toBe(await spentIn(w40.prevFrom, w40.prevTo));
    // over-months uses the exact dates: partial edge months, same total as the categories tab
    const [pf, pt] = [`${m3}-10`, `${m1}-20`];
    const pm = await json<{ points: { month: string; partial: boolean; expensesMinor: number }[] }>('GET', `/api/trends/monthly?from=${pf}&to=${pt}`, { cookie: o.cookie });
    expect(pm.body.points.map((p) => p.partial)).toEqual([true, false, true]);
    const pc = await json<{ totalMinor: number }>('GET', `/api/trends/categories?from=${pf}&to=${pt}`, { cookie: o.cookie });
    expect(pm.body.points.reduce((a, p) => a + p.expensesMinor, 0)).toBe(pc.body.totalMinor);
    // a year: monthly buckets; over-months covers the months spanned
    expect((await json<Daily>('GET', `/api/trends/daily?from=${monthStart(addMonths(cur, -11))}&to=${monthEnd(cur)}`, { cookie: o.cookie })).body.granularity).toBe('month');
    const m = await json<{ points: { month: string }[] }>('GET', `/api/trends/monthly?from=${monthStart(m3)}&to=${monthEnd(m1)}`, { cookie: o.cookie });
    expect(m.body.points.map((p) => p.month)).toEqual([m3, addMonths(m3, 1), m1]);
    // validation
    for (const qs of [`from=${monthStart(m1)}`, `from=${monthEnd(m1)}&to=${monthStart(m1)}`, 'from=2020-01-01&to=2026-01-01', 'from=2026-02-30&to=2026-03-01'])
      expect((await json('GET', `/api/trends/daily?${qs}`, { cookie: o.cookie })).status).toBe(400);
    // both endpoints share one cap
    const longest = `from=2024-01-01&to=${addDays('2024-01-01', MAX_RANGE_DAYS - 1)}`;
    const tooLong = `from=2024-01-01&to=${addDays('2024-01-01', MAX_RANGE_DAYS)}`;
    for (const ep of ['daily', 'monthly', 'categories']) {
      expect((await json('GET', `/api/trends/${ep}?${longest}`, { cookie: o.cookie })).status).toBe(200);
      expect((await json('GET', `/api/trends/${ep}?${tooLong}`, { cookie: o.cookie })).status).toBe(400);
    }
    expect((await json('GET', `/api/trends/monthly?from=${monthEnd(m1)}&to=${monthStart(m1)}`, { cookie: o.cookie })).status).toBe(400);
  });
});
