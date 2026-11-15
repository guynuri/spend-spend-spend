import { describe, expect, it } from 'vitest';
import { baselineDaily, computeForecast, type ForecastInput } from '../../src/shared/domain/forecast';
import type { RecItem } from '../../src/shared/domain/recurring';

const item = (p: Partial<RecItem>): RecItem => ({
  id: 'x', name: 'X', kind: 'expense', amount_minor: -1000, amount_mode: 'fixed', cadence: 'monthly', day_of_month: 1, anchor_date: '2026-01-01',
  start_date: null, end_date: null, account_id: 'a', category_id: null, match_norm: 'x', status: 'active', created_at: '2026-01-01', ...p,
});
const base = (p: Partial<ForecastInput> = {}): ForecastInput => ({
  today: '2026-11-15', asOf: '2026-11-15', forecastAccountIds: ['a'], startBalance: 1000000, items: [], overrides: [], settled: [], planned: [], actuals: [],
  baseline: { setting: 0, v: 0, d: 0, monthOfA: null }, completeMonths: 3, safetyBuffer: 0, ...p,
});
const sumCheck = (f: ReturnType<typeof computeForecast>) => {
  const b = f.breakdown;
  expect(f.startBalance + b.income + b.recurring + b.card + b.planned + b.variable + b.actuals).toBe(f.eom!.balance);
};

describe('forecast (§10.3, AC7.1–7.4)', () => {
  it('A = T and nothing happens: flat; low is today', () => {
    const f = computeForecast(base());
    expect(f.eom).toEqual({ date: '2026-11-30', balance: 1000000 });
    expect(f.low).toEqual({ date: '2026-11-15', balance: 1000000 });
    expect(f.series.at(-1)!.date).toBe('2026-12-31');
    expect(f.confidence).toBe('high');
    sumCheck(f);
  });

  it('recurring, card estimate, income, variable; exact sum; low point & after-card', () => {
    const f = computeForecast(
      base({
        items: [item({ id: 'rent', amount_minor: -500000, day_of_month: 1 }), item({ id: 'sal', kind: 'income', amount_minor: 1400000, day_of_month: 25 }), item({ id: 'card', kind: 'card_charge', amount_mode: 'estimated', match_norm: '', day_of_month: 20, amount_minor: -700000 })],
        settled: [{ recurring_id: 'card', due: '2026-10-20', amount_minor: -800000 }, { recurring_id: 'card', due: '2026-09-20', amount_minor: -600000 }, { recurring_id: 'rent', due: '2026-11-01', amount_minor: -500000 }],
        baseline: { setting: null, v: 9100000, d: 91, monthOfA: null },
      }),
    );
    expect(f.baselineDaily).toBe(100000);
    expect(f.breakdown).toEqual({ income: 1400000, recurring: 0, card: -700000, planned: 0, variable: -1500000, actuals: 0 });
    expect(f.eom!.balance).toBe(1000000 + 1400000 - 700000 - 1500000);
    sumCheck(f);
    expect(f.low).toEqual({ date: '2026-11-24', balance: 1000000 - 900000 - 700000 });
    expect(f.afterNextCard).toEqual({ date: '2026-11-20', balance: 1000000 - 500000 - 700000 });
    expect(f.belowZero).toBe(true);
    expect(f.events.find((e) => e.itemId === 'rent')!.date).toBe('2026-12-01');
  });

  it('AC7.2: a planned expense of X before month end lowers EOM by exactly X', () => {
    const a = computeForecast(base({ baseline: { setting: 12345, v: 0, d: 0, monthOfA: null } }));
    const b = computeForecast(base({ baseline: { setting: 12345, v: 0, d: 0, monthOfA: null }, planned: [{ id: 'p', name: 'Gift', amount_minor: -123400, date: '2026-11-20', account_id: 'a', card_recurring_id: null, status: 'planned' }] }));
    expect(a.eom!.balance - b.eom!.balance).toBe(123400);
    expect(b.breakdown.planned).toBe(-123400);
    sumCheck(b);
  });

  it('planned by card adds to the next card charge unless that charge has an override', () => {
    const card = item({ id: 'card', kind: 'card_charge', match_norm: '', amount_mode: 'estimated', day_of_month: 10, amount_minor: -700000 });
    const planned = [{ id: 'p', name: 'Flights', amount_minor: -300000, date: '2026-11-20', account_id: null, card_recurring_id: 'card', status: 'planned' as const }];
    const f = computeForecast(base({ items: [card], planned }));
    expect(f.events.find((e) => e.due === '2026-12-10')!.amountMinor).toBe(-1000000);
    const g = computeForecast(base({ items: [card], planned, overrides: [{ recurring_id: 'card', due_date: '2026-12-10', amount_minor: -500000, skipped: 0 }] }));
    expect(g.events.find((e) => e.due === '2026-12-10')!.amountMinor).toBe(-500000);
  });

  it('override amount and skipped occurrence', () => {
    const it = item({ id: 'r', amount_minor: -1000, day_of_month: 20 });
    expect(computeForecast(base({ items: [it], overrides: [{ recurring_id: 'r', due_date: '2026-11-20', amount_minor: -5000, skipped: 0 }] })).breakdown.recurring).toBe(-5000);
    expect(computeForecast(base({ items: [it], overrides: [{ recurring_id: 'r', due_date: '2026-11-20', amount_minor: null, skipped: 1 }] })).breakdown.recurring).toBe(0);
  });

  it('occurrence due on A: settled → nothing, unsettled → scheduled A+1; older than 5 days → missed', () => {
    const it = item({ id: 'r', amount_minor: -1000, day_of_month: 15 });
    expect(computeForecast(base({ items: [it], settled: [{ recurring_id: 'r', due: '2026-11-15', amount_minor: -1000 }] })).breakdown.recurring).toBe(0);
    const late = computeForecast(base({ items: [it] }));
    expect(late.events[0]).toMatchObject({ date: '2026-11-16', late: true });
    const m = computeForecast(base({ asOf: '2026-11-25', today: '2026-11-25', items: [item({ id: 'r', day_of_month: 15 })] }));
    expect(m.missed).toEqual([{ itemId: 'r', label: 'X', due: '2026-11-15', amountMinor: -1000 }]);
    sumCheck(m);
  });

  it('planned overdue is excluded and listed; within 5 days → A+1', () => {
    const p = (date: string) => ({ id: 'p', name: 'P', amount_minor: -100, date, account_id: 'a', card_recurring_id: null, status: 'planned' as const });
    const f = computeForecast(base({ planned: [p('2026-11-01')] }));
    expect(f.overdue).toHaveLength(1);
    expect(f.breakdown.planned).toBe(0);
    expect(computeForecast(base({ planned: [p('2026-11-12')] })).events[0]!.date).toBe('2026-11-16');
  });

  it('A in a previous month (stale), series starts at A; low only from T', () => {
    const f = computeForecast(base({ asOf: '2026-10-01', startBalance: 500, baseline: { setting: 10, v: 0, d: 0, monthOfA: null } }));
    expect(f.stale).toBe(true);
    expect(f.confidence).toBe('low');
    expect(f.series[0]).toEqual({ date: '2026-10-01', balance: 500 });
    expect(f.low!.date).toBe('2026-11-30');
    sumCheck(f);
  });

  it('negative start balance; buffer flag', () => {
    const f = computeForecast(base({ startBalance: -5000, safetyBuffer: 100 }));
    expect(f.belowZero).toBe(true);
    expect(f.belowBuffer).toBe(true);
    expect(computeForecast(base({ startBalance: 50, safetyBuffer: 100 })).belowBuffer).toBe(true);
  });

  it('manual transaction after A larger than the daily baseline zeroes that day only', () => {
    const f = computeForecast(
      base({
        today: '2026-11-20',
        asOf: '2026-11-15',
        baseline: { setting: 1000, v: 0, d: 0, monthOfA: null },
        actuals: [{ id: 't', date: '2026-11-17', amount_minor: -5000, account_id: 'a', recurring_id: null, planned_id: null, isExpense: true, manual: true }],
      }),
    );
    const day = (d: string) => f.series.find((s) => s.date === d)!.balance;
    expect(day('2026-11-16')).toBe(1000000 - 1000);
    expect(day('2026-11-17')).toBe(1000000 - 1000 - 5000);
    expect(f.breakdown.actuals).toBe(-5000);
    expect(f.breakdown.variable).toBe(-1000 * 14);
    sumCheck(f);
  });

  it('year boundary (December → January) and February', () => {
    const f = computeForecast(base({ today: '2026-12-20', asOf: '2026-12-20', items: [item({ id: 'r', day_of_month: 31 })] }));
    expect(f.series.at(-1)!.date).toBe('2027-01-31');
    expect(f.events.map((e) => e.date)).toEqual(['2026-12-31', '2027-01-31']);
    const g = computeForecast(base({ today: '2027-01-20', asOf: '2027-01-20', items: [item({ id: 'r', day_of_month: 31 })] }));
    expect(g.events.map((e) => e.date)).toEqual(['2027-01-31', '2027-02-28']);
  });

  it('no forecast accounts → low confidence, empty series', () => {
    const f = computeForecast(base({ forecastAccountIds: [] }));
    expect(f).toMatchObject({ confidence: 'low', series: [], eom: null, hasForecastAccount: false });
  });

  it('variable baseline: setting > V/D > month of A (≥ 10 days) > 0 (low confidence)', () => {
    expect(baselineDaily({ setting: 5, v: 900, d: 9, monthOfA: null })).toEqual({ daily: 5, low: false });
    expect(baselineDaily({ setting: null, v: 900, d: 9, monthOfA: null })).toEqual({ daily: 100, low: false });
    expect(baselineDaily({ setting: null, v: 0, d: 0, monthOfA: { sum: 1000, days: 10 } })).toEqual({ daily: 100, low: false });
    expect(baselineDaily({ setting: null, v: 0, d: 0, monthOfA: { sum: 1000, days: 9 } })).toEqual({ daily: 0, low: true });
  });

  it('confidence: medium when A is more than 7 days old or < 3 complete months', () => {
    expect(computeForecast(base({ asOf: '2026-11-01' })).confidence).toBe('medium');
    expect(computeForecast(base({ completeMonths: 2 })).confidence).toBe('medium');
    expect(computeForecast(base({ completeMonths: 0 })).confidence).toBe('low');
  });
});
