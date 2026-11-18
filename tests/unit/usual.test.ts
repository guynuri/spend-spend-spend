import { describe, expect, it } from 'vitest';
import { usualMonth } from '../../src/shared/domain/usual';

const cats = new Map([
  ['groc', { name: 'Groceries', system: false }],
  ['fun', { name: 'Leisure', system: false }],
  ['card', { name: 'Credit card (not split)', system: true }],
]);

describe('a usual month', () => {
  it('averages over the base months (missing months count as 0), shares of income and spending, this month vs usual', () => {
    const u = usualMonth({
      months: ['2026-08', '2026-09', '2026-10'],
      pnl: new Map([
        ['2026-08', { income: 1_000_000, expenses: 600_000 }],
        ['2026-09', { income: 1_000_000, expenses: 500_000 }],
        ['2026-10', { income: 1_000_000, expenses: 400_000 }],
      ]),
      spent: new Map([
        ['groc', new Map([['2026-08', 150_000], ['2026-09', 120_000], ['2026-10', 180_000]])],
        ['fun', new Map([['2026-09', 30_000]])], // only one month: averages to 10,000
        ['card', new Map([['2026-10', 900_000]])], // placeholder category: not listed
      ]),
      thisMonth: new Map([['groc', 160_000], ['fun', 2_000]]),
      categories: cats,
    })!;
    expect(u).toMatchObject({ avgIncomeMinor: 1_000_000, avgExpensesMinor: 500_000, spendShareOfIncome: 0.5, unassignedMinor: 500_000 - 150_000 - 10_000, otherMinor: 0 });
    expect(u.items).toEqual([
      { categoryId: 'groc', name: 'Groceries', avgMinor: 150_000, shareOfIncome: 0.15, shareOfSpending: 0.3, thisMonthMinor: 160_000, over: true},
      { categoryId: 'fun', name: 'Leisure', avgMinor: 10_000, shareOfIncome: 0.01, shareOfSpending: 0.02, thisMonthMinor: 2_000, over: false},
    ]);
  });

  it('a net refund category lowers the categorized total, so uncategorized spending is not understated', () => {
    const u = usualMonth({
      months: ['2026-10'],
      pnl: new Map([['2026-10', { income: 0, expenses: 450_000 }]]), // 400k + 100k uncategorized − 50k refund
      spent: new Map([['groc', new Map([['2026-10', 400_000]])], ['fun', new Map([['2026-10', -50_000]])]]),
      thisMonth: new Map(),
      categories: cats,
    })!;
    expect(u.items.map((x) => x.categoryId)).toEqual(['groc']);
    expect(u.unassignedMinor).toBe(100_000);
  });

  it('no complete month → null; no income → shares of spending only; top N', () => {
    expect(usualMonth({ months: [], pnl: new Map(), spent: new Map(), thisMonth: new Map(), categories: cats })).toBeNull();
    const u = usualMonth({
      months: ['2026-10'],
      pnl: new Map([['2026-10', { income: 0, expenses: 2000 }]]),
      spent: new Map([['groc', new Map([['2026-10', 1500]])], ['fun', new Map([['2026-10', 500]])]]),
      thisMonth: new Map(),
      categories: cats,
      limit: 1,
    })!;
    expect(u.spendShareOfIncome).toBeNull();
    expect(u.otherMinor).toBe(500); // Leisure, past the limit
    expect(u.items).toEqual([{ categoryId: 'groc', name: 'Groceries', avgMinor: 1500, shareOfIncome: null, shareOfSpending: 0.75, thisMonthMinor: 0, over: false}]);
  });
});
