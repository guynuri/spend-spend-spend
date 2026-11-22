import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import type { Suggestion } from '../../src/shared/domain/suggest';
import type { BudgetView } from '../../src/shared/domain/budget';

describe('suggested budgets', () => {
  it('suggests from the usual months, respects the options, and applying sets the limits', async () => {
    const o = await ownerSetup();
    // no data: nothing to suggest
    expect((await json<{ suggestion: null }>('GET', '/api/budgets/suggest', { cookie: o.cookie })).body.suggestion).toBeNull();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const get = async (q = '') => (await json<{ suggestion: Suggestion; month: string }>('GET', `/api/budgets/suggest${q}`, { cookie: o.cookie })).body;
    const r = await get('?squeeze=0&savings=0');
    const s = r.suggestion;
    expect(s.months.length).toBeGreaterThan(0);
    expect(s.incomeMinor).toBeGreaterThan(0);
    const rent = s.lines.find((l) => l.name === 'Rent')!;
    expect(rent).toMatchObject({ kind: 'fixed' });
    expect(rent.suggestedMinor).toBeGreaterThanOrEqual(rent.usualMinor);
    // a bigger squeeze never raises an everyday limit
    const tight = (await get('?squeeze=0.1&savings=0')).suggestion;
    for (const l of tight.lines.filter((x) => x.kind === 'everyday')) expect(l.suggestedMinor).toBeLessThanOrEqual(s.lines.find((x) => x.categoryId === l.categoryId)!.suggestedMinor);
    expect((await json('GET', '/api/budgets/suggest?squeeze=0.3', { cookie: o.cookie })).status).toBe(400);

    // applying (what the sheet sends) sets recurring limits from this period
    const items = s.lines.map((l) => (l.kind === 'general' ? { general: true, limitMinor: l.suggestedMinor } : l.kind === 'occasional' ? { categoryId: l.categoryId, limitMinor: l.suggestedMinor, yearly: true } : { categoryId: l.categoryId, limitMinor: l.suggestedMinor }));
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: r.month, items } })).status).toBe(200);
    const v = (await json<BudgetView>('GET', `/api/budgets?month=${r.month}`, { cookie: o.cookie })).body;
    expect(v.lines.find((l) => l.categoryId === rent.categoryId)!.limitMinor).toBe(rent.suggestedMinor);
  });
});
