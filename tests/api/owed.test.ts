import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { todayInTz } from '../../src/shared/dates';
import type { BudgetView } from '../../src/shared/domain/budget';
import type { Category, Tx } from '../../src/shared/schemas/ledger';

describe('someone will pay me back', () => {
  it('only my share is spending; their repayment cancels the rest; the balance shows on Home', async () => {
    const o = await ownerSetup();
    const today = todayInTz('Asia/Jerusalem');
    const acc = (await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Chk', type: 'checking' } })).body.id;
    const cats = (await json<{ categories: Category[] }>('GET', '/api/categories', { cookie: o.cookie })).body.categories;
    const owedCat = cats.find((c) => c.systemKey === 'owed')!;
    expect(owedCat).toMatchObject({ kind: 'transfer', emoji: '🤝' });
    const food = cats.find((c) => c.name === 'Eating out')!;
    const dash = async () => (await json<{ pnl: { incomeMinor: number; expensesMinor: number }; owed: { minor: number } }>('GET', '/api/dashboard', { cookie: o.cookie })).body;
    const before = await dash();

    // dinner for two, ₪200, a friend pays back ₪100
    const tx = await json<Tx>('POST', '/api/transactions', { cookie: o.cookie, body: { date: today, amountMinor: 20000, direction: 'out', description: 'Dinner', accountId: acc, categoryId: food.id, owedMinor: 10000 } });
    expect(tx.status).toBe(201);
    let d = await dash();
    expect(d.pnl.expensesMinor - before.pnl.expensesMinor).toBe(10000);
    expect(d.owed.minor).toBe(10000);
    const month = (await json<BudgetView>('GET', '/api/budgets', { cookie: o.cookie })).body;
    expect(month.lines.find((l) => l.categoryId === food.id)!.spentMinor).toBe(10000);

    // the Bit repayment, put in "Owed to me": not income, and the balance is settled
    await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: today, amountMinor: 10000, direction: 'in', description: 'Bit from Noa', accountId: acc, categoryId: owedCat.id } });
    d = await dash();
    expect(d.pnl.incomeMinor).toBe(before.pnl.incomeMinor);
    expect(d.owed.minor).toBe(0);

    // change it on an existing purchase, then remove it
    const lunch = (await json<Tx>('POST', '/api/transactions', { cookie: o.cookie, body: { date: today, amountMinor: 9000, direction: 'out', description: 'Lunch', accountId: acc, categoryId: food.id } })).body;
    const set = await json<Tx>('PUT', `/api/transactions/${lunch.id}/owed`, { cookie: o.cookie, body: { owedMinor: 3000 } });
    expect(set.body.splits.map((s) => [s.categoryId, s.amountMinor])).toEqual([
      [food.id, -6000],
      [owedCat.id, -3000],
    ]);
    expect((await dash()).owed.minor).toBe(3000);
    expect((await json('PUT', `/api/transactions/${lunch.id}/owed`, { cookie: o.cookie, body: { owedMinor: 9000 } })).body).toMatchObject({ error: { code: 'owed_too_big' } });
    const cleared = await json<Tx>('PUT', `/api/transactions/${lunch.id}/owed`, { cookie: o.cookie, body: { owedMinor: 0 } });
    expect(cleared.body).toMatchObject({ hasSplits: false, categoryId: food.id });
    expect((await dash()).owed.minor).toBe(0);
    // an income can't be "paid back"
    expect((await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: today, amountMinor: 500, direction: 'in', description: 'x', accountId: acc, owedMinor: 100 } })).status).toBe(400);
  });
});
