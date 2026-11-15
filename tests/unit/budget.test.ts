import { describe, expect, it } from 'vitest';
import { asOfDate, completeMonths, displayMonth, elapsedFraction, isStale, lastCompleteMonths } from '../../src/shared/domain/common';
import { budgetStatus, buildBudgetView, limitFor, utilization } from '../../src/shared/domain/budget';

describe('common definitions (§10.1)', () => {
  it('as-of date', () => {
    expect(asOfDate('2026-11-15', '2026-11-10', '2026-11-12')).toBe('2026-11-12');
    expect(asOfDate('2026-11-15', null, null)).toBe('2026-11-15');
    expect(asOfDate('2026-11-15', '2026-12-01', null)).toBe('2026-11-15');
    expect(isStale('2026-11-15', '2026-10-10')).toBe(true);
    expect(isStale('2026-11-15', '2026-10-11')).toBe(false);
  });
  it('complete months', () => {
    const c = completeMonths(['2026-08', '2026-09', '2026-10', '2026-11'], '2026-11-14');
    expect(c).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(completeMonths(['2026-10', '2026-11'], '2026-11-30')).toEqual(['2026-10', '2026-11']);
    expect(lastCompleteMonths(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'], 3, '2026-10')).toEqual(['2026-07', '2026-08', '2026-09']);
  });
  it('elapsed fraction', () => {
    expect(elapsedFraction('2026-10', '2026-11-15', '2026-11-14')).toBe(1);
    expect(elapsedFraction('2026-12', '2026-11-15', '2026-11-14')).toBe(0);
    expect(elapsedFraction('2026-11', '2026-11-15', '2026-11-12')).toBeCloseTo(12 / 30);
    expect(elapsedFraction('2026-11', '2026-11-15', '2026-10-31')).toBeNull();
  });
  it('displayed month (AC11.3)', () => {
    expect(displayMonth('2026-11-15', '2026-11-02')).toEqual({ month: '2026-11', isLatestData: false });
    expect(displayMonth('2026-11-15', '2026-10-31')).toEqual({ month: '2026-10', isLatestData: true });
    expect(displayMonth('2026-11-15', null)).toEqual({ month: '2026-11', isLatestData: false });
  });
});

describe('budget (§10.4, AC5.1–5.3)', () => {
  const rows = [
    { category_id: 'g', effective_from: '2026-01', limit_minor: 100000 },
    { category_id: 'g', effective_from: '2026-06', limit_minor: 120000 },
    { category_id: 'e', effective_from: '2026-03', limit_minor: 50000 },
    { category_id: 'e', effective_from: '2026-09', limit_minor: null },
  ];
  it('limit applies from M until changed; earlier months keep theirs; null removes', () => {
    expect(limitFor(rows, 'g', '2025-12')).toBeNull();
    expect(limitFor(rows, 'g', '2026-05')).toBe(100000);
    expect(limitFor(rows, 'g', '2026-06')).toBe(120000);
    expect(limitFor(rows, 'g', '2027-01')).toBe(120000);
    expect(limitFor(rows, 'e', '2026-08')).toBe(50000);
    expect(limitFor(rows, 'e', '2026-09')).toBeNull();
  });
  it('status rules on both sides of every threshold', () => {
    expect(budgetStatus(1001, 1000, 'fixed', 0.5)).toBe('over');
    expect(budgetStatus(1000, 1000, 'fixed', 0.5)).toBe('on_pace');
    expect(budgetStatus(900, 1000, 'variable', 1)).toBe('watch'); // u ≥ 0.9
    expect(budgetStatus(899, 1000, 'variable', 1)).toBe('on_pace');
    expect(budgetStatus(610, 1000, 'variable', 0.5)).toBe('watch'); // u ≥ 0.5 and u > f + 0.10
    expect(budgetStatus(600, 1000, 'variable', 0.5)).toBe('on_pace');
    expect(budgetStatus(499, 1000, 'variable', 0.1)).toBe('on_pace');
    expect(budgetStatus(950, 1000, 'fixed', 0.1)).toBe('on_pace'); // fixed never "watch"
    expect(budgetStatus(10, 1000, 'variable', null)).toBeNull(); // no data yet
    expect(budgetStatus(1, 0, 'variable', 0.5)).toBe('over');
    expect(utilization(1, 0)).toBe(Infinity);
    expect(utilization(0, 0)).toBe(0);
  });
  it('view totals, pace, unbudgeted, allocation, groups', () => {
    const v = buildBudgetView({
      month: '2026-10',
      f: 0.5,
      categories: [
        { id: 'g', name: 'Groceries', grp: 'variable', archived: false },
        { id: 'r', name: 'Rent', grp: 'fixed', archived: false },
        { id: 'x', name: 'Other', grp: 'variable', archived: false },
      ],
      budgets: [
        { category_id: 'g', effective_from: '2026-01', limit_minor: 100000 },
        { category_id: 'r', effective_from: '2026-01', limit_minor: 500000 },
      ],
      spent: new Map([
        ['g', 80000],
        ['r', 500000],
        ['x', 30000],
      ]),
      history: new Map([['g', new Map([['2026-07', 90000], ['2026-08', 60000], ['2026-09', 90000]])]]),
      avgMonths: ['2026-07', '2026-08', '2026-09'],
      expensesMinor: 650000,
      avgIncomeMinor: 2000000,
      incomeMonths: ['2026-07', '2026-08', '2026-09'],
      unsplitCardMinor: 12345,
    });
    expect(v.totals.budgetedMinor).toBe(600000);
    expect(v.totals.spentBudgetedMinor).toBe(580000);
    expect(v.totals.pctSpent).toBeCloseTo(580000 / 600000);
    expect(v.totals.pace).toBe('ahead');
    expect(v.totals.unbudgetedSpentMinor).toBe(70000);
    expect(v.totals.counts).toEqual({ over: 0, watch: 1, on_pace: 1 });
    expect(v.totals.fixed).toEqual({ budgetedMinor: 500000, spentMinor: 500000 });
    expect(v.lines.find((l) => l.categoryId === 'g')!.avg3Minor).toBe(80000);
    expect(v.lines.find((l) => l.categoryId === 'x')!.status).toBeNull();
    expect(v.allocation).toMatchObject({ budgetedMinor: 600000, avgIncomeMinor: 2000000 });
    expect(v.unsplitCardMinor).toBe(12345);
  });
});
