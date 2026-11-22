import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { todayInTz } from '../../src/shared/dates';
import { makeCal } from '../../src/shared/period';
import type { BudgetView } from '../../src/shared/domain/budget';

type Budget = BudgetView & { period: { start: string; end: string; startDay: number } };

describe('pay-day periods', () => {
  it('budget, overview, ledger and forecast follow the pay day; trends follow it or calendar months', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const today = todayInTz('Asia/Jerusalem');
    const cal = makeCal(10);
    const cur = cal.of(today);

    // default: calendar months
    let b = (await json<Budget>('GET', '/api/budgets', { cookie: o.cookie })).body;
    expect(b.period).toMatchObject({ start: `${today.slice(0, 7)}-01`, startDay: 1 });

    expect((await json('PATCH', '/api/household', { cookie: o.cookie, body: { periodStartDay: 29 } })).status).toBe(400);
    expect((await json('PATCH', '/api/household', { cookie: o.cookie, body: { periodStartDay: 10 } })).status).toBe(200);
    const hh = (await json<{ periodStartDay: number; statsByPeriod: boolean }>('GET', '/api/household', { cookie: o.cookie })).body;
    expect(hh).toMatchObject({ periodStartDay: 10, statsByPeriod: true });
    expect((await json<{ active: { periodStartDay: number } }>('GET', '/api/me', { cookie: o.cookie })).body.active.periodStartDay).toBe(10);

    // the budget's current period runs from the 10th to the 9th, and its spending is exactly the ledger's over those dates
    b = (await json<Budget>('GET', '/api/budgets', { cookie: o.cookie })).body;
    expect(b.month).toBe(cur);
    expect(b.period).toEqual({ start: cal.start(cur), end: cal.end(cur), startDay: 10 });
    const acc = (await json<{ accounts: { id: string; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie })).body.accounts.find((a) => a.type === 'checking')!;
    const groceries = b.lines.find((l) => l.name === 'Groceries')!;
    // a purchase on the period's first day counts; one the day before belongs to the previous period
    await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: cal.start(cur), amountMinor: 7777, direction: 'out', description: 'In period', accountId: acc.id, categoryId: groceries.categoryId } });
    const prevDay = new Date(Date.parse(cal.start(cur)) - 86_400_000).toISOString().slice(0, 10);
    await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: prevDay, amountMinor: 3333, direction: 'out', description: 'Before', accountId: acc.id, categoryId: groceries.categoryId } });
    const after = (await json<Budget>('GET', '/api/budgets', { cookie: o.cookie })).body.lines.find((l) => l.categoryId === groceries.categoryId)!;
    expect(after.spentMinor).toBe(groceries.spentMinor + 7777);

    // the ledger's default range is the current period
    const list = (await json<{ items: { description: string }[] }>('GET', '/api/transactions', { cookie: o.cookie })).body.items;
    expect(list.some((t) => t.description === 'In period')).toBe(true);
    expect(list.some((t) => t.description === 'Before')).toBe(false);

    // overview: the same period, and the forecast's "month end" is the period's end
    const d = (await json<{ month: string; period: { start: string; end: string }; forecast: { eom: { date: string } | null } }>('GET', '/api/dashboard', { cookie: o.cookie })).body;
    expect(d.month).toBe(cur);
    expect(d.period).toMatchObject({ start: cal.start(cur), end: cal.end(cur) });
    if (d.forecast.eom) expect(d.forecast.eom.date).toBe(cal.end(cur));

    // trends follow the period by default…
    const tr = async () => (await json<{ from: string; to: string }>('GET', `/api/trends/categories?month=${cur}`, { cookie: o.cookie })).body;
    expect(await tr()).toMatchObject({ from: cal.start(cur), to: cal.end(cur) });
    // …or calendar months, when chosen; the budget keeps the pay day
    expect((await json('PATCH', '/api/household', { cookie: o.cookie, body: { statsByPeriod: false } })).status).toBe(200);
    expect(await tr()).toMatchObject({ from: `${cur}-01` });
    expect((await json<Budget>('GET', '/api/budgets', { cookie: o.cookie })).body.period.start).toBe(cal.start(cur));
  });
});
