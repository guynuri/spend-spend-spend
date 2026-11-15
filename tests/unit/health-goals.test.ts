import { describe, expect, it } from 'vitest';
import { CURVES, computeHealth, label, lerp, recommendations, type HealthInput } from '../../src/shared/domain/health';
import { goalView, goalsSummary, type GoalIn } from '../../src/shared/domain/goals';
import { buildInsights, type InsightInput } from '../../src/shared/domain/insights';

describe('health curves: every breakpoint and midpoints (AC9.1)', () => {
  const table: [keyof typeof CURVES, number, number][] = [
    ['savings', -0.2, 0], ['savings', -0.1, 0], ['savings', -0.05, 15], ['savings', 0, 30], ['savings', 0.05, 47.5], ['savings', 0.1, 65], ['savings', 0.15, 77.5], ['savings', 0.2, 90], ['savings', 0.25, 95], ['savings', 0.3, 100], ['savings', 0.5, 100],
    ['debt', 0, 100], ['debt', 0.075, 95], ['debt', 0.15, 90], ['debt', 0.225, 77.5], ['debt', 0.3, 65], ['debt', 0.33, 57.5], ['debt', 0.36, 50], ['debt', 0.43, 32.5], ['debt', 0.5, 15], ['debt', 0.55, 7.5], ['debt', 0.6, 0], ['debt', 0.9, 0],
    ['cushion', 0, 0], ['cushion', 0.5, 12.5], ['cushion', 1, 25], ['cushion', 2, 47.5], ['cushion', 3, 70], ['cushion', 4.5, 85], ['cushion', 6, 100], ['cushion', 12, 100],
    ['budget', 0, 0], ['budget', 0.25, 20], ['budget', 0.5, 40], ['budget', 0.65, 60], ['budget', 0.8, 80], ['budget', 0.9, 90], ['budget', 1, 100],
    ['goals', 0, 0], ['goals', 0.5, 50], ['goals', 1, 100],
  ];
  for (const [k, x, y] of table) it(`${k}(${x}) = ${y}`, () => expect(lerp(CURVES[k], x)).toBeCloseTo(y, 6));
  it('labels', () => {
    expect([label(85), label(84.9), label(70), label(69), label(50), label(49)]).toEqual(['excellent', 'good', 'good', 'fair', 'fair', 'needs_attention']);
  });
});

const base: HealthInput = { income: 3000000, expenses: 2400000, months: 3, debtPayments: 300000, liquid: 2400000, budget: { ok: 8, total: 10, overMinor: 50000 }, goals: { onTrack: 1, dated: 2, extraMonthlyMinor: 70000 } };

describe('health score (AC9.1–9.3)', () => {
  it('weighted overall', () => {
    const r = computeHealth(base);
    // savings 0.2 → 90; debt 0.1 → 93.33; cushion 3 → 70; budget 0.8 → 80; goals 0.5 → 50
    const exp = (25 * 90 + 20 * (100 - (10 / 0.15) * 0.1) + 25 * 70 + 15 * 80 + 15 * 50) / 100;
    expect(r.overall).toBe(Math.round(exp));
    expect(r.subs.savings.score).toBe(90);
  });
  it('null rules and re-normalization; < 2 sub-scores → no overall', () => {
    const noIncome = computeHealth({ ...base, income: 0 });
    expect(noIncome.subs.savings.score).toBe(0);
    expect(noIncome.subs.debt.score).toBeNull();
    const nothing = computeHealth({ ...base, income: 0, expenses: 0, liquid: null, budget: { ok: 0, total: 0, overMinor: 0 }, goals: { onTrack: 0, dated: 0, extraMonthlyMinor: 0 } });
    expect(nothing.overall).toBeNull();
    const two = computeHealth({ ...base, liquid: null, budget: { ok: 0, total: 0, overMinor: 0 }, goals: { onTrack: 0, dated: 0, extraMonthlyMinor: 0 } });
    expect(two.overall).toBe(Math.round((25 * 90 + 20 * (100 - (10 / 0.15) * 0.1)) / 45));
    expect(computeHealth({ ...base, liquid: null }).subs.cushion.score).toBeNull();
    expect(computeHealth({ ...base, expenses: 0 }).subs.cushion.score).toBeNull();
  });
  it('recommendations with point gains, top 3 sorted', () => {
    const r = recommendations(base);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.length).toBeGreaterThan(0);
    for (let k = 1; k < r.length; k++) expect(r[k - 1]!.gain).toBeGreaterThanOrEqual(r[k]!.gain);
    expect(r.every((x) => x.gain >= 0.5)).toBe(true);
    expect(r[0]!.key).toBe('goals_on_track');
    expect(r[0]!.amountMinor).toBe(70000);
    expect(recommendations({ ...base, income: 0, expenses: 0, liquid: null, budget: { ok: 0, total: 0, overMinor: 0 }, goals: { onTrack: 0, dated: 0, extraMonthlyMinor: 0 } })).toEqual([]);
  });
});

const g = (p: Partial<GoalIn> = {}): GoalIn => ({ id: 'g', name: 'Fund', target_minor: 1200000, start_minor: 0, start_date: '2026-01-01', target_date: '2027-01-01', priority: 1, status: 'active', ...p });
describe('goals (§10.5, AC8.1–8.3)', () => {
  it('saved, progress, required monthly, on track vs behind', () => {
    const v = goalView(g(), [{ goal_id: 'g', date: '2026-02-01', amount_minor: 600000 }], '2026-07-02');
    expect(v.savedMinor).toBe(600000);
    expect(v.progress).toBe(0.5);
    expect(v.remainingMinor).toBe(600000);
    expect(v.requiredMonthlyMinor).toBe(Math.ceil(600000 / Math.ceil(183 / 30.4375)));
    expect(v.status).toBe('on_track');
    expect(goalView(g(), [{ goal_id: 'g', date: '2026-02-01', amount_minor: 100000 }], '2026-07-02').status).toBe('behind');
    expect(goalView(g({ target_date: '2026-06-01' }), [], '2026-07-02').status).toBe('behind');
    expect(goalView(g({ target_date: null }), [], '2026-07-02').status).toBe('no_deadline');
    expect(goalView(g({ target_date: '2025-01-01' }), [], '2024-07-02').expectedByNowMinor).toBe(1200000);
  });
  it('milestones at 25/50/75/100 with the crossing date; 100 % completes', () => {
    const v = goalView(g({ start_minor: 300000 }), [
      { goal_id: 'g', date: '2026-03-01', amount_minor: 400000 },
      { goal_id: 'g', date: '2026-04-01', amount_minor: 600000 },
    ], '2026-05-01');
    expect(v.milestones).toEqual([
      { pct: 25, date: '2026-01-01' },
      { pct: 50, date: '2026-03-01' },
      { pct: 75, date: '2026-04-01' },
      { pct: 100, date: '2026-04-01' },
    ]);
    expect(v.status).toBe('completed');
    expect(v.progress).toBe(1);
  });
  it('pace and projected finish; summary and capital allocation', () => {
    const v = goalView(g({ target_date: null }), [
      { goal_id: 'g', date: '2026-04-05', amount_minor: 100000 },
      { goal_id: 'g', date: '2026-05-05', amount_minor: 100000 },
      { goal_id: 'g', date: '2026-06-05', amount_minor: 100000 },
    ], '2026-07-02');
    expect(v.paceMinor).toBe(100000);
    expect(v.projectedFinish).toBe('2027-04-02');
    const s = goalsSummary([v, goalView(g({ id: 'h' }), [], '2026-07-02')], 200000);
    expect(s).toMatchObject({ activeCount: 2, behindCount: 1, surplusMinor: 200000 });
    expect(s.pctAllocated).toBeCloseTo(s.committedMonthlyMinor / 200000);
    expect(goalsSummary([v], -5).noSurplus).toBe(true);
  });
});

describe('action items (§10.7, AC11.2)', () => {
  const inp = (p: Partial<InsightInput> = {}): InsightInput => ({
    stale: false, asOf: '2026-11-14', hasForecastAccount: true, low: { date: '2026-11-20', balance: 5000 }, belowBuffer: false, safetyBuffer: 0, uncategorized60: 0, month: '2026-11', isCurrentMonth: true, f: 0.6,
    unsplitCardMinor: 0, lines: [], pace: null, suggestedCount: 0, bigPayments: [], goals: [], lastComplete: null, ...p,
  });
  it('each rule fires and the order is alert, warn, info, good', () => {
    const line = (id: string, status: 'over' | null, spent: number, avg: number, rem: number | null) => ({ categoryId: id, name: id, grp: 'variable' as const, limitMinor: rem === null ? null : spent + rem, spentMinor: spent, remainingMinor: rem, utilization: null, status, avg3Minor: avg });
    const r = buildInsights(
      inp({
        stale: true,
        low: { date: '2026-11-20', balance: -100 },
        uncategorized60: 4,
        unsplitCardMinor: 700000,
        lines: [line('a', 'over', 1000, 0, -10), line('b', 'over', 1000, 0, -20), line('c', 'over', 1000, 0, -30), line('d', 'over', 1000, 0, -40), line('e', null, 60000, 20000, null)],
        pace: { thisMinor: 120, prevMinor: 100, day: 15 },
        suggestedCount: 2,
        bigPayments: [{ label: 'Rent', date: '2026-11-16', amountMinor: -500000 }],
        goals: [{ id: 'g', name: 'Fund', status: 'behind', archived: false, requiredMonthlyMinor: 5, milestones: [{ pct: 50, date: '2026-11-03' }] } as never],
        lastComplete: { month: '2026-10', savingsRate: 0.25, budgeted: 10, spentBudgeted: 9 },
      }),
    );
    expect(r.map((x) => x.key)).toEqual(['low_point_negative', 'stale_data', 'uncategorized', 'budget_over', 'budget_over', 'budget_over', 'budget_over_more', 'goal_behind', 'card_unsplit', 'category_spike', 'pace_more', 'recurring_suggested', 'payment_soon', 'goal_milestone', 'savings_good', 'under_budget']);
    expect(r.find((x) => x.key === 'budget_over')!.params.category).toBe('d');
  });
  it('spike only compares pro-rated spend when f ≥ 0.5; pace needs ≥ 10 %', () => {
    const l = { categoryId: 'e', name: 'e', grp: 'variable' as const, limitMinor: null, spentMinor: 20000, remainingMinor: null, utilization: null, status: null, avg3Minor: 20000 };
    expect(buildInsights(inp({ f: 0.4, lines: [{ ...l, spentMinor: 40000 }] })).some((x) => x.key === 'category_spike')).toBe(false);
    expect(buildInsights(inp({ f: 0.5, lines: [l] })).some((x) => x.key === 'category_spike')).toBe(true);
    expect(buildInsights(inp({ pace: { thisMinor: 109, prevMinor: 100, day: 3 } })).some((x) => x.key.startsWith('pace'))).toBe(false);
    expect(buildInsights(inp({ pace: { thisMinor: 80, prevMinor: 100, day: 3 } })).find((x) => x.key === 'pace_less')!.severity).toBe('good');
  });
});

import { buildReview, finalSummary, notableTransactions, trend } from '../../src/shared/domain/review';
describe('review builder (§10.8)', () => {
  it('trend, notable transactions, commentary keys, chips', () => {
    expect([trend(106, 100), trend(94, 100), trend(103, 100), trend(5, 0), trend(0, 0)]).toEqual(['up', 'down', 'flat', 'flat', 'flat']);
    const txs = [-100, -200, -300, -100000, -60000, -1000].map((a, i) => ({ amountMinor: a, i }));
    expect(notableTransactions(txs).map((t) => t.amountMinor)).toEqual([-100000, -60000]);
    const r = buildReview({
      month: '2026-10',
      isLatestMonth: true,
      health: { score: 72, label: 'good', change: 4, recommendations: [] },
      income: { totalMinor: 1000, prevMinor: 1000, byCategory: [{ categoryId: 'a', name: 'A', amountMinor: 1000 }] },
      spending: { totalMinor: 1200, prevMinor: 1000, byCategory: [], transactions: [] },
      budget: { budgetedMinor: 100, spentBudgetedMinor: 90, lines: [{ name: 'x', spentMinor: 90, limitMinor: 100 }] },
      goals: { activeCount: 1, savedMinor: 5, targetMinor: 10, items: [{ name: 'g', progress: 0.5, requiredMonthlyMinor: 1, status: 'on_track', milestones: [{ pct: 50, date: '2026-10-03' }] }] },
      forecast: { eomMinor: 1, lowMinor: 0, lowDate: '2026-11-20' },
      upcoming: [],
      insights: [],
    });
    expect(r.summary.chips).toEqual(['score_up', 'milestone', 'under_budget']);
    expect(r.spending.commentary.key).toBe('review.c.spending.up_under');
    expect(r.income.commentary.key).toBe('review.c.income.flat');
    expect(r.cashflow.commentary.key).toBe('review.c.cashflow.negative');
    expect(r.wrapup.headline.key).toBe('review.h.good_up');
    expect(r.goals.items[0]!.milestones).toEqual([50]);
    // final summary: deterministic wins / focus / numbered actions from the snapshot alone
    const f = finalSummary(r);
    expect(f.savingsRate).toBeCloseTo(-0.2);
    expect(f.wins.map((w) => w.key)).toEqual(['review.fin.win.score_up', 'review.fin.win.budgets', 'review.fin.win.milestone']);
    expect(f.wins[2]!.params).toEqual({ name: 'g', pct: 0.5 });
    expect(f.focus.map((w) => w.key)).toEqual(['review.fin.focus.net', 'review.fin.focus.spending_up']);
    expect(f.focus[0]!.params.netMinor).toBe(200);
    expect(f.actions.map((a) => a.key)).toEqual(['review.fin.act.next_review']);
    const over = finalSummary({ ...r, budget: { ...r.budget, total: 1, ok: 0, lines: [{ name: 'x', spentMinor: 150, limitMinor: 100, overMinor: 50 }] }, wrapup: { ...r.wrapup, nextSteps: [{ key: 'savings', gain: 2, amountMinor: 10 } as never] } });
    expect(over.focus[1]).toEqual({ key: 'review.fin.focus.over', params: { name: 'x', overMinor: 50 } });
    expect(over.actions.map((a) => a.key)).toEqual(['health.recs.savings', 'review.fin.act.over', 'review.fin.act.next_review']);
    expect(over.actions[0]!.gain).toBe(2);
    // thresholds use the rate as displayed (whole percents)
    const at = (savingsRate: number) => finalSummary({ ...r, cashflow: { ...r.cashflow, savingsRate } });
    expect(at(0.0996).focus.map((x) => x.key)).not.toContain('review.fin.focus.low_savings');
    expect(at(0.094).focus.map((x) => x.key)).toContain('review.fin.focus.low_savings');
    expect(at(0.1996).wins.map((x) => x.key)).toContain('review.fin.win.savings');
    expect(at(0.194).wins.map((x) => x.key)).not.toContain('review.fin.win.savings');
  });
});
