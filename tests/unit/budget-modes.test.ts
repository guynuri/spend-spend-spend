import { describe, expect, it } from 'vitest';
import { buildBudgetView, GENERAL_ID, monthlyBudgetLines, yearlyLimitFor, yearlyStatus } from '../../src/shared/domain/budget';
import { usualMonth } from '../../src/shared/domain/usual';
import { buildInsights, type InsightInput } from '../../src/shared/domain/insights';
import { buildReview, type ReviewInput } from '../../src/shared/domain/review';

const categories = [
  { id: 'groc', name: 'Groceries', grp: 'variable' as const, archived: false, mode: 'monthly' as const },
  { id: 'cloth', name: 'Clothing', grp: 'variable' as const, archived: false, mode: 'general' as const },
  { id: 'hair', name: 'Hair', grp: 'variable' as const, archived: false, mode: 'general' as const },
  { id: 'trip', name: 'Vacation', grp: 'variable' as const, archived: false, mode: 'occasional' as const },
];

describe('budget modes', () => {
  it('yearly limits carry forward by year; yearly status has no pace rule', () => {
    const rows = [
      { category_id: 'trip', year: '2025', limit_minor: 800000 },
      { category_id: 'trip', year: '2027', limit_minor: null },
    ];
    expect(yearlyLimitFor(rows, 'trip', '2024')).toBeNull();
    expect(yearlyLimitFor(rows, 'trip', '2026')).toBe(800000);
    expect(yearlyLimitFor(rows, 'trip', '2027')).toBeNull();
    expect(yearlyStatus(100, 1000)).toBe('on_pace');
    expect(yearlyStatus(900, 1000)).toBe('watch');
    expect(yearlyStatus(1001, 1000)).toBe('over');
  });

  it('general categories share one line and limit; occasional ones get a yearly section outside the monthly totals', () => {
    const v = buildBudgetView({
      month: '2026-10',
      f: 0.5,
      categories,
      // a monthly limit left on a category that is now general is ignored
      budgets: [
        { category_id: 'groc', effective_from: '2026-01', limit_minor: 200000 },
        { category_id: 'cloth', effective_from: '2026-01', limit_minor: 1 },
      ],
      generalBudgets: [{ category_id: GENERAL_ID, effective_from: '2026-01', limit_minor: 50000 }],
      yearlyBudgets: [{ category_id: 'trip', year: '2026', limit_minor: 1000000 }],
      spent: new Map([['groc', 150000], ['cloth', 30000], ['hair', 25000], ['trip', 700000]]),
      history: new Map([['cloth', new Map([['2026-09', 30000]])], ['hair', new Map([['2026-09', 3000]])]]),
      avgMonths: ['2026-07', '2026-08', '2026-09'],
      expensesMinor: 150000 + 55000 + 700000 + 10000,
      avgIncomeMinor: 0,
      incomeMonths: [],
      unsplitCardMinor: 0,
      ytd: new Map([['trip', 950000]]),
      last12: new Map([['trip', 1200000]]),
      generalName: 'General expenses',
    });
    expect(v.lines.map((l) => l.categoryId).sort()).toEqual(['general', 'groc']);
    const g = v.lines.find((l) => l.categoryId === GENERAL_ID)!;
    expect(g).toMatchObject({ name: 'General expenses', limitMinor: 50000, spentMinor: 55000, status: 'over', avg3Minor: 11000 });
    expect(g.members!.map((m) => m.categoryId)).toEqual(['cloth', 'hair']);
    expect(v.totals.budgetedMinor).toBe(250000);
    expect(v.totals.spentBudgetedMinor).toBe(205000);
    // the trip is in its own section, not "spending without a budget"
    expect(v.totals.unbudgetedSpentMinor).toBe(10000);
    expect(v.occasional).toMatchObject({ year: '2026', totals: { yearBudgetedMinor: 1000000, ytdMinor: 950000, monthMinor: 700000, last12Minor: 1200000 } });
    expect(v.occasional.lines[0]).toMatchObject({ categoryId: 'trip', remainingMinor: 50000, status: 'watch' });
  });

  it('monthly budget lines (history, health) include the general pool and never occasional spending', () => {
    const spent: Record<string, number> = { groc: 100, cloth: 20, hair: 30, trip: 999 };
    const ls = monthlyBudgetLines(categories, [{ category_id: 'groc', effective_from: '2026-01', limit_minor: 150 }, { category_id: 'trip', effective_from: '2026-01', limit_minor: 5 }], [{ category_id: GENERAL_ID, effective_from: '2026-05', limit_minor: 40 }], (c) => spent[c] ?? 0, '2026-06');
    expect(ls).toEqual([
      { id: 'groc', limit: 150, spent: 100 },
      { id: GENERAL_ID, limit: 40, spent: 50 },
    ]);
    expect(monthlyBudgetLines(categories, [], [{ category_id: GENERAL_ID, effective_from: '2026-05', limit_minor: 40 }], () => 1, '2026-04')).toEqual([]);
  });

  it('usual month: general pooled, occasional spread over its longer window and never "over"', () => {
    const u = usualMonth({
      months: ['2026-09', '2026-10'],
      occasionalMonths: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'],
      pnl: new Map([
        ['2026-09', { income: 1_000_000, expenses: 1_300_000 }], // includes a 1,000,000 trip
        ['2026-10', { income: 1_000_000, expenses: 300_000 }],
      ]),
      spent: new Map([
        ['groc', new Map([['2026-09', 200_000], ['2026-10', 200_000]])],
        ['cloth', new Map([['2026-09', 40_000]])],
        ['hair', new Map([['2026-10', 20_000]])],
        ['trip', new Map([['2026-09', 1_000_000]])],
      ]),
      thisMonth: new Map([['trip', 500_000], ['cloth', 10_000]]),
      categories: new Map(categories.map((c) => [c.id, { name: c.name, system: false, mode: c.mode }])),
      generalName: 'General',
    })!;
    // everyday: (300k + 300k) / 2 = 300k; the trip: 1,000,000 / 10 = 100k
    expect(u.avgExpensesMinor).toBe(400_000);
    expect(u.items.find((i) => i.categoryId === 'trip')).toMatchObject({ kind: 'occasional', avgMinor: 100_000, thisMonthMinor: 500_000, over: false });
    expect(u.items.find((i) => i.categoryId === GENERAL_ID)).toMatchObject({ kind: 'general', name: 'General', avgMinor: 30_000, thisMonthMinor: 10_000 });
    expect(u.items.some((i) => i.categoryId === 'cloth')).toBe(false);
    expect(u.unassignedMinor).toBe(400_000 - 200_000 - 30_000 - 100_000);
  });

  it('insights: an occasional category over its yearly budget; the general line links to the budget', () => {
    const base: InsightInput = {
      stale: false, asOf: '2026-10-31', hasForecastAccount: true, low: null, belowBuffer: false, safetyBuffer: 0, uncategorized60: 0, month: '2026-10', isCurrentMonth: false, f: 1, unsplitCardMinor: 0,
      lines: [{ categoryId: GENERAL_ID, name: 'General', grp: 'variable', limitMinor: null, oneTime: false, spentMinor: 90000, remainingMinor: null, utilization: null, status: null, avg3Minor: 30000 }],
      occasional: [{ categoryId: 'trip', name: 'Vacation', yearLimitMinor: 100, ytdMinor: 150, monthMinor: 0, last12Minor: 150, remainingMinor: -50, utilization: 1.5, status: 'over' }],
      pace: null, suggestedCount: 0, bigPayments: [], goals: [], lastComplete: null,
    };
    const out = buildInsights(base);
    expect(out.find((i) => i.key === 'budget_over_year')).toMatchObject({ params: { category: 'Vacation', amountMinor: 50, year: '2026' } });
    expect(out.find((i) => i.key === 'category_spike')!.href).toBe('/budget?month=2026-10');
  });

  it('review: with occasional spending, the month-to-month comparison uses everyday spending', () => {
    const input: ReviewInput = {
      month: '2026-10', isLatestMonth: false,
      health: { score: null, label: null, change: null, recommendations: [] },
      income: { totalMinor: 1_000_000, prevMinor: 1_000_000, byCategory: [] },
      spending: { totalMinor: 1_300_000, prevMinor: 300_000, byCategory: [{ categoryId: 'trip', name: 'Vacation', amountMinor: 1_000_000, occasional: true }], transactions: [], occasionalMinor: 1_000_000, prevOccasionalMinor: 0 },
      budget: { budgetedMinor: 0, spentBudgetedMinor: 0, lines: [] },
      goals: { activeCount: 0, savedMinor: 0, targetMinor: 0, items: [] },
      forecast: null, upcoming: [], insights: [],
    };
    const s = buildReview(input);
    expect(s.spending.commentary.key).toBe('review.c.everyday.flat_under');
    expect(s.spending.changePct).toBe(0);
    expect(s.spending.occasional).toMatchObject({ minor: 1_000_000, commentary: { key: 'review.c.occasional.this', params: { names: 'Vacation' } } });
    const plain = buildReview({ ...input, spending: { ...input.spending, totalMinor: 330_000, byCategory: [], occasionalMinor: 0 } });
    expect(plain.spending.commentary.key).toBe('review.c.spending.up_under');
    expect(plain.spending.occasional).toBeUndefined();
  });
});
