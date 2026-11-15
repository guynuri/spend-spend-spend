import { describe, expect, it } from 'vitest';
import { daySpread, detectRecurring, dueDates, expectedAmount, linkTransactions, occurrences, recurringTotals, type DetectRow, type RecItem } from '../../src/shared/domain/recurring';

export const item = (p: Partial<RecItem> = {}): RecItem => ({
  id: 'i1',
  name: 'Rent',
  kind: 'expense',
  amount_minor: -500000,
  amount_mode: 'fixed',
  cadence: 'monthly',
  day_of_month: 1,
  anchor_date: '2026-01-01',
  start_date: null,
  end_date: null,
  account_id: 'a1',
  category_id: null,
  match_norm: 'rent',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  ...p,
});

describe('occurrences (§10.2)', () => {
  it('monthly with day-31 clamping and February', () => {
    expect(dueDates(item({ day_of_month: 31 }), '2026-01-15', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(dueDates(item({ day_of_month: 30, anchor_date: '2024-01-30' }), '2024-02-01', '2024-02-29')).toEqual(['2024-02-29']);
  });
  it('bimonthly/quarterly/yearly counted from the anchor month; weekly from the anchor date', () => {
    expect(dueDates(item({ cadence: 'bimonthly', anchor_date: '2026-01-15', day_of_month: 15 }), '2026-02-01', '2026-07-31')).toEqual(['2026-03-15', '2026-05-15', '2026-07-15']);
    expect(dueDates(item({ cadence: 'quarterly', anchor_date: '2025-11-05', day_of_month: 5 }), '2026-01-01', '2026-12-31')).toEqual(['2026-02-05', '2026-05-05', '2026-08-05', '2026-11-05']);
    expect(dueDates(item({ cadence: 'yearly', anchor_date: '2025-03-10', day_of_month: 10 }), '2026-01-01', '2027-12-31')).toEqual(['2026-03-10', '2027-03-10']);
    expect(dueDates(item({ cadence: 'weekly', anchor_date: '2026-11-02' }), '2026-11-05', '2026-11-30')).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  });
  it('bounded by start/end', () => {
    expect(dueDates(item({ start_date: '2026-03-01', end_date: '2026-04-30' }), '2026-01-01', '2026-12-31')).toEqual(['2026-03-01', '2026-04-01']);
  });
  it('skipped and overridden occurrences; settled flag', () => {
    const occ = occurrences(item(), '2026-01-01', '2026-03-31', [{ recurring_id: 'i1', due_date: '2026-02-01', amount_minor: -1, skipped: 0 }, { recurring_id: 'i1', due_date: '2026-03-01', amount_minor: null, skipped: 1 }], [{ recurring_id: 'i1', due: '2026-01-01', amount_minor: -500000 }]);
    expect(occ.map((o) => [o.due, o.amountMinor, o.skipped, o.settled])).toEqual([
      ['2026-01-01', -500000, false, true],
      ['2026-02-01', -1, false, false],
      ['2026-03-01', -500000, true, false],
    ]);
  });
  it('expected amount for estimated items: 0, 1, 3, 5 settled charges (AC6.3)', () => {
    const it = item({ amount_mode: 'estimated', kind: 'card_charge', amount_minor: -700000 });
    expect(expectedAmount(it, undefined, [])).toBe(-700000);
    expect(expectedAmount(it, undefined, [-600000])).toBe(-600000);
    expect(expectedAmount(it, undefined, [-600000, -900000, -700000])).toBe(-733333);
    expect(expectedAmount(it, undefined, [-600000, -900000, -700000, -1, -2])).toBe(-733333);
    expect(expectedAmount(it, { recurring_id: 'i1', due_date: 'x', amount_minor: -123, skipped: 0 }, [-600000])).toBe(-123);
    expect(expectedAmount(item(), undefined, [-1])).toBe(-500000);
  });
  it('totals: monthly and yearly cost of active expenses (AC6.6)', () => {
    const items = [item(), item({ id: 'b', cadence: 'yearly', amount_minor: -120000 }), item({ id: 'c', cadence: 'weekly', amount_minor: -1200 }), item({ id: 'd', kind: 'income', amount_minor: 100 }), item({ id: 'e', status: 'paused' })];
    const t = recurringTotals(items, new Map());
    expect(t.monthlyMinor).toBe(Math.round(500000 + 10000 + (1200 * 52) / 12));
    expect(t.yearlyMinor).toBe(Math.round((500000 + 10000 + (1200 * 52) / 12) * 12));
  });
});

describe('settlement linking (§10.2)', () => {
  const tx = (id: string, date: string, amount: number, dn: string, kind: 'normal' | 'card_lump' = 'normal') => ({ id, account_id: 'a1', date, amount_minor: amount, description_norm: dn, kind });
  it('links to the nearest unsettled occurrence within ±10 days and tolerance', () => {
    const items = [item()];
    expect(linkTransactions(items, [tx('t1', '2026-02-03', -500000, 'rent standing order')], [], [])).toEqual([{ txId: 't1', itemId: 'i1', due: '2026-02-01' }]);
    expect(linkTransactions(items, [tx('t1', '2026-02-03', -560000, 'rent')], [], [])).toEqual([]); // > 10 %
    expect(linkTransactions(items, [tx('t1', '2026-02-15', -500000, 'rent')], [], [])).toEqual([]); // > 10 days
    expect(linkTransactions(items, [tx('t1', '2026-02-03', 500000, 'rent')], [], [])).toEqual([]); // sign
    expect(linkTransactions(items, [tx('t1', '2026-02-03', -500000, 'rent')], [], [{ recurring_id: 'i1', due: '2026-02-01', amount_minor: -500000 }])).toEqual([]);
  });
  it('card charge with empty match links card lumps; estimated ±40 %', () => {
    const card = item({ id: 'c', kind: 'card_charge', match_norm: '', amount_mode: 'estimated', day_of_month: 10, amount_minor: -700000 });
    expect(linkTransactions([card], [tx('t', '2026-03-10', -1500000, 'isracard', 'card_lump')], [], [])).toHaveLength(1);
    expect(linkTransactions([card], [tx('t', '2026-03-10', -1500000, 'isracard', 'normal')], [], [])).toHaveLength(0);
    const est = item({ amount_mode: 'estimated', amount_minor: -10000, match_norm: 'electric' });
    expect(linkTransactions([est], [tx('t', '2026-03-01', -13900, 'electric co')], [], [])).toHaveLength(1);
    expect(linkTransactions([est], [tx('t', '2026-03-01', -14100, 'electric co')], [], [])).toHaveLength(0);
  });
  it('two cards on one account: each charge settles the card due nearest to it', () => {
    const c10 = item({ id: 'c10', kind: 'card_charge', match_norm: '', amount_mode: 'estimated', day_of_month: 10, anchor_date: '2026-01-10', created_at: '1' });
    const c2 = item({ id: 'c2', kind: 'card_charge', match_norm: '', amount_mode: 'estimated', day_of_month: 2, anchor_date: '2026-01-02', created_at: '2' });
    const l = linkTransactions([c10, c2], [tx('a', '2026-03-02', -300000, 'isracard', 'card_lump'), tx('b', '2026-03-10', -700000, 'cal', 'card_lump')], [], []);
    expect(l).toEqual([{ txId: 'a', itemId: 'c2', due: '2026-03-02' }, { txId: 'b', itemId: 'c10', due: '2026-03-10' }]);
    // an item that names its issuer wins over a catch-all one, whatever the dates
    const named = item({ id: 'cal', kind: 'card_charge', match_norm: 'cal', amount_mode: 'estimated', day_of_month: 15, anchor_date: '2026-01-15', created_at: '3' });
    expect(linkTransactions([c10, named], [tx('b', '2026-03-10', -700000, 'cal', 'card_lump')], [], [])[0]!.itemId).toBe('cal');
  });
  it('items are tried in creation order', () => {
    const a = item({ id: 'a', created_at: '2026-02-01', match_norm: 'rent' });
    const b = item({ id: 'b', created_at: '2026-01-01', match_norm: 'rent' });
    expect(linkTransactions([a, b], [tx('t', '2026-03-01', -500000, 'rent')], [], [])[0]!.itemId).toBe('b');
  });
});

describe('detection thresholds (§10.2, AC6.2)', () => {
  const rows = (dates: string[], amounts: number[], key = 'netflix', lump = false): DetectRow[] => dates.map((d, i) => ({ account_id: 'a', key, sign: -1, lump, date: d, amount_minor: amounts[i] ?? amounts[0]!, category_id: 'c' }));
  it('3 months, once a month, same day → monthly fixed', () => {
    const s = detectRecurring(rows(['2026-07-07', '2026-08-07', '2026-09-08'], [-5490]));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'expense', cadence: 'monthly', amount_mode: 'fixed', amount_minor: -5490, day_of_month: 7, category_id: 'c' });
  });
  it('2 consecutive months only within 2 %', () => {
    expect(detectRecurring(rows(['2026-08-07', '2026-09-07'], [-1000, -1020]))).toHaveLength(1);
    expect(detectRecurring(rows(['2026-08-07', '2026-09-07'], [-1000, -1021]))).toHaveLength(0);
    expect(detectRecurring(rows(['2026-07-07', '2026-09-07'], [-1000, -1000]))).toHaveLength(0);
  });
  it('day spread ≤ 6 (circular) and amount spread ≤ 25 %', () => {
    expect(detectRecurring(rows(['2026-07-01', '2026-08-07', '2026-09-04'], [-1000]))).toHaveLength(1);
    expect(detectRecurring(rows(['2026-07-01', '2026-08-08', '2026-09-04'], [-1000]))).toHaveLength(0);
    expect(daySpread([30, 2, 3])).toBe(4);
    expect(detectRecurring(rows(['2026-07-30', '2026-08-02', '2026-09-03'], [-1000]))).toHaveLength(1);
    expect(detectRecurring(rows(['2026-07-07', '2026-08-07', '2026-09-07'], [-1000, -1250, -1000]))).toHaveLength(1);
    expect(detectRecurring(rows(['2026-07-07', '2026-08-07', '2026-09-07'], [-1000, -1260, -1000]))).toHaveLength(0);
  });
  it('≥ 80 % of months exactly once', () => {
    expect(detectRecurring(rows(['2026-06-07', '2026-07-07', '2026-07-08', '2026-08-07', '2026-09-07', '2026-10-07'], [-1000]))).toHaveLength(1);
    expect(detectRecurring(rows(['2026-07-07', '2026-07-08', '2026-08-07', '2026-09-07'], [-1000]))).toHaveLength(0);
  });
  it('card lumps ignore amount spread; bimonthly when alternating; income', () => {
    const lump = detectRecurring(rows(['2026-07-10', '2026-08-10', '2026-09-10'], [-600000, -900000, -700000], 'isracard', true));
    expect(lump[0]).toMatchObject({ kind: 'card_charge', match_norm: 'isracard', amount_mode: 'estimated' });
    expect(detectRecurring(rows(['2026-05-15', '2026-07-15', '2026-09-15'], [-98000]))[0]!.cadence).toBe('bimonthly');
    const inc = detectRecurring(rows(['2026-07-01', '2026-08-01', '2026-09-01'], [1450000]).map((r) => ({ ...r, sign: 1 as const })));
    expect(inc[0]!.kind).toBe('income');
  });
});
