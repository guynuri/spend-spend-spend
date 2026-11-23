import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { addMonths, monthOf, todayInTz } from '../../src/shared/dates';
import type { BudgetView } from '../../src/shared/domain/budget';
import type { Category } from '../../src/shared/schemas/ledger';

describe('subcategories, emoji and colour', () => {
  it('rolls a subcategory up into its parent everywhere, and statistics can break it down', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const m = addMonths(monthOf(todayInTz('Asia/Jerusalem')), -1);
    const cats = async () => (await json<{ categories: Category[] }>('GET', '/api/categories', { cookie: o.cookie })).body.categories;
    const groceries = (await cats()).find((c) => c.name === 'Groceries')!;
    // default categories come with a look
    expect(groceries).toMatchObject({ emoji: '🛒', color: 'cat-6', parentId: null });

    // a subcategory inherits kind, group and budget mode
    const sub = await json<{ id: string }>('POST', '/api/categories', { cookie: o.cookie, body: { name: 'Organic shop', kind: 'expense', parentId: groceries.id, emoji: '🥕', color: 'cat-3', budgetMode: 'occasional' } });
    expect(sub.status).toBe(201);
    let s = (await cats()).find((c) => c.id === sub.body.id)!;
    expect(s).toMatchObject({ parentId: groceries.id, emoji: '🥕', color: 'cat-3', grp: groceries.grp, budgetMode: groceries.budgetMode });
    // without a colour of its own, a subcategory wears its parent's
    const plain = await json<{ id: string }>('POST', '/api/categories', { cookie: o.cookie, body: { name: 'Bakery', kind: 'expense', parentId: groceries.id } });
    expect((await cats()).find((c) => c.id === plain.body.id)!.color).toBe(groceries.color);
    // categories say when they were last used (for "recently used first")
    expect((await cats()).some((c) => c.lastUsed)).toBe(true);
    // bad parents and bad looks are refused
    const salary = (await cats()).find((c) => c.name === 'Salary')!;
    expect((await json('POST', '/api/categories', { cookie: o.cookie, body: { name: 'X1', kind: 'expense', parentId: salary.id } })).body).toMatchObject({ error: { code: 'bad_parent' } });
    expect((await json('POST', '/api/categories', { cookie: o.cookie, body: { name: 'X2', kind: 'expense', parentId: sub.body.id } })).body).toMatchObject({ error: { code: 'bad_parent' } });
    expect((await json('POST', '/api/categories', { cookie: o.cookie, body: { name: 'X3', kind: 'expense', emoji: 'abc' } })).status).toBe(400);
    expect((await json('POST', '/api/categories', { cookie: o.cookie, body: { name: 'X4', kind: 'expense', color: '#ff0000' } })).status).toBe(400);
    // a parent with subcategories can't become one
    const eating = (await cats()).find((c) => c.name === 'Eating out')!;
    expect((await json('PATCH', `/api/categories/${groceries.id}`, { cookie: o.cookie, body: { parentId: eating.id } })).body).toMatchObject({ error: { code: 'has_subcategories' } });

    // spending on the subcategory counts in the parent's budget line; the subcategory has no line or limit of its own
    const before = (await json<BudgetView>('GET', `/api/budgets?month=${m}`, { cookie: o.cookie })).body.lines.find((l) => l.categoryId === groceries.id)!.spentMinor;
    const acc = (await json<{ accounts: { id: string; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie })).body.accounts.find((a) => a.type === 'checking')!;
    expect((await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: `${m}-10`, amountMinor: 12345, direction: 'out', description: 'Organic', accountId: acc.id, categoryId: sub.body.id } })).status).toBe(201);
    const v = (await json<BudgetView>('GET', `/api/budgets?month=${m}`, { cookie: o.cookie })).body;
    expect(v.lines.find((l) => l.categoryId === groceries.id)!.spentMinor).toBe(before + 12345);
    expect(v.lines.some((l) => l.categoryId === sub.body.id)).toBe(false);
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: m, items: [{ categoryId: sub.body.id, limitMinor: 100 }] } })).body).toMatchObject({ error: { code: 'subcategory_budget' } });

    // the ledger filtered by the parent includes the subcategory's rows
    const rows = (await json<{ items: { description: string }[] }>('GET', `/api/transactions?from=${m}-01&to=${m}-28&category=${groceries.id}`, { cookie: o.cookie })).body.items;
    expect(rows.some((r) => r.description === 'Organic')).toBe(true);

    // trends: one row for the parent, broken down by subcategory (its own lines under its own id)
    const tr = (await json<{ items: { categoryId: string | null; spentMinor: number; subs?: { categoryId: string; spentMinor: number }[] }[] }>('GET', `/api/trends/categories?month=${m}`, { cookie: o.cookie })).body.items;
    const g = tr.find((i) => i.categoryId === groceries.id)!;
    expect(tr.some((i) => i.categoryId === sub.body.id)).toBe(false);
    expect(g.subs!.find((x) => x.categoryId === sub.body.id)!.spentMinor).toBe(12345);
    expect(g.subs!.reduce((a, x) => a + x.spentMinor, 0)).toBe(g.spentMinor);

    // changing the parent's mode carries to the subcategory; archiving it archives both; emoji can be cleared
    expect((await json('PATCH', `/api/categories/${groceries.id}`, { cookie: o.cookie, body: { budgetMode: 'general', emoji: '' } })).status).toBe(200);
    s = (await cats()).find((c) => c.id === sub.body.id)!;
    expect(s.budgetMode).toBe('general');
    expect((await cats()).find((c) => c.id === groceries.id)!.emoji).toBeNull();
    expect((await json('DELETE', `/api/categories/${groceries.id}`, { cookie: o.cookie })).body).toMatchObject({ archived: true });
    expect((await cats()).find((c) => c.id === sub.body.id)!.archived).toBe(true);
    // moving a subcategory out makes it a main category again
    expect((await json('PATCH', `/api/categories/${sub.body.id}`, { cookie: o.cookie, body: { parentId: null, archived: false } })).status).toBe(200);
    expect((await cats()).find((c) => c.id === sub.body.id)).toMatchObject({ parentId: null, archived: false });
  });
});
