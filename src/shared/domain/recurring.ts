/** Recurring items: occurrences, expected amounts, settlement, detection, totals (PLAN §10.2). */
import { addDays, addMonths, clampDay, daysBetween, dayOf, monthDiff, monthOf, type DateStr, type MonthStr } from '../dates';

export type Cadence = 'weekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
export type RecKind = 'expense' | 'income' | 'card_charge';
export interface RecItem {
  id: string;
  name: string;
  kind: RecKind;
  amount_minor: number;
  amount_mode: 'fixed' | 'estimated';
  cadence: Cadence;
  day_of_month: number | null;
  anchor_date: DateStr;
  start_date: DateStr | null;
  end_date: DateStr | null;
  account_id: string | null;
  category_id: string | null;
  match_norm: string;
  status: 'active' | 'paused' | 'suggested' | 'dismissed';
  created_at: string;
}
export interface Override {
  recurring_id: string;
  due_date: DateStr;
  amount_minor: number | null;
  skipped: number;
}
export interface Settled {
  recurring_id: string;
  due: DateStr;
  amount_minor: number;
  tx_id?: string;
}

export const STEP: Record<Exclude<Cadence, 'weekly'>, number> = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 };
export const MONTHLY_FACTOR: Record<Cadence, number> = { weekly: 52 / 12, monthly: 1, bimonthly: 1 / 2, quarterly: 1 / 3, yearly: 1 / 12 };

/** Due dates of an item in [from, to] (no weekend shifting — D-28). */
export function dueDates(item: Pick<RecItem, 'cadence' | 'day_of_month' | 'anchor_date' | 'start_date' | 'end_date'>, from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const lo = item.start_date && item.start_date > from ? item.start_date : from;
  const hi = item.end_date && item.end_date < to ? item.end_date : to;
  if (lo > hi) return out;
  if (item.cadence === 'weekly') {
    const k = Math.ceil(daysBetween(item.anchor_date, lo) / 7);
    for (let d = addDays(item.anchor_date, Math.max(k, 0) * 7); d <= hi; d = addDays(d, 7)) if (d >= lo) out.push(d);
    return out;
  }
  const step = STEP[item.cadence];
  const day = item.day_of_month ?? dayOf(item.anchor_date);
  const anchorM = monthOf(item.anchor_date);
  let m: MonthStr = monthOf(lo);
  const off = ((monthDiff(anchorM, m) % step) + step) % step;
  if (off) m = addMonths(m, step - off);
  for (; m <= monthOf(hi); m = addMonths(m, step)) {
    const d = clampDay(m, day);
    if (d >= lo && d <= hi && d >= (item.start_date ?? '0000')) out.push(d);
  }
  return out;
}

/** Expected amount: override → estimated mean of last ≤ 3 settled actuals → amount_minor. */
export function expectedAmount(item: Pick<RecItem, 'amount_mode' | 'amount_minor' | 'kind'>, override: Override | undefined, settledDesc: number[]): number {
  if (override?.amount_minor !== null && override?.amount_minor !== undefined) return override.amount_minor;
  if ((item.amount_mode === 'estimated' || item.kind === 'card_charge') && settledDesc.length) {
    const xs = settledDesc.slice(0, 3);
    return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  }
  return item.amount_minor;
}

export interface Occurrence {
  itemId: string;
  due: DateStr;
  amountMinor: number;
  overridden: boolean;
  skipped: boolean;
  settled: boolean;
}

export function occurrences(item: RecItem, from: DateStr, to: DateStr, overrides: Override[], settled: Settled[]): Occurrence[] {
  const ov = new Map(overrides.filter((o) => o.recurring_id === item.id).map((o) => [o.due_date, o]));
  const mine = settled.filter((s) => s.recurring_id === item.id);
  const settledDues = new Set(mine.map((s) => s.due));
  const desc = [...mine].sort((a, b) => (a.due < b.due ? 1 : -1)).map((s) => s.amount_minor);
  return dueDates(item, from, to).map((due) => {
    const o = ov.get(due);
    return { itemId: item.id, due, amountMinor: expectedAmount(item, o, desc), overridden: o?.amount_minor !== null && o?.amount_minor !== undefined, skipped: o?.skipped === 1, settled: settledDues.has(due) };
  });
}

/** Monthly / yearly cost of active expense and card items (AC6.6). */
export function recurringTotals(items: RecItem[], expected: Map<string, number>) {
  let monthly = 0;
  for (const i of items) if (i.status === 'active' && i.kind !== 'income') monthly += Math.abs(expected.get(i.id) ?? i.amount_minor) * MONTHLY_FACTOR[i.cadence];
  return { monthlyMinor: Math.round(monthly), yearlyMinor: Math.round(monthly * 12) };
}

// ---------------- settlement linking ----------------
export interface LinkTx {
  id: string;
  account_id: string;
  date: DateStr;
  amount_minor: number;
  description_norm: string;
  kind: 'normal' | 'card_lump';
}
const TOL = { fixed: 0.1, estimated: 0.4 };

/** For each unlinked transaction, the first active item (creation order) it settles (PLAN §10.2). */
export function linkTransactions(items: RecItem[], txs: LinkTx[], overrides: Override[], settled: Settled[]): { txId: string; itemId: string; due: DateStr }[] {
  const active = items.filter((i) => i.status === 'active').sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id.localeCompare(b.id)));
  const taken = new Set(settled.map((s) => `${s.recurring_id}|${s.due}`));
  const out: { txId: string; itemId: string; due: DateStr }[] = [];
  for (const tx of [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const it of active) {
      if (Math.sign(tx.amount_minor) !== Math.sign(it.amount_minor)) continue;
      if (it.account_id && it.account_id !== tx.account_id) continue;
      if (it.kind === 'card_charge' && !it.match_norm) {
        if (tx.kind !== 'card_lump') continue;
      } else if (!it.match_norm || !tx.description_norm.includes(it.match_norm)) continue;
      if (it.kind !== 'card_charge') {
        const desc = settled.filter((s) => s.recurring_id === it.id).sort((a, b) => (a.due < b.due ? 1 : -1)).map((s) => s.amount_minor);
        const exp = Math.abs(expectedAmount(it, undefined, desc));
        if (exp > 0 && Math.abs(Math.abs(tx.amount_minor) - exp) > TOL[it.amount_mode] * exp) continue;
      }
      const cands = dueDates(it, addDays(tx.date, -10), addDays(tx.date, 10)).filter((d) => !taken.has(`${it.id}|${d}`) && !overrides.some((o) => o.recurring_id === it.id && o.due_date === d && o.skipped === 1));
      if (!cands.length) continue;
      cands.sort((a, b) => Math.abs(daysBetween(a, tx.date)) - Math.abs(daysBetween(b, tx.date)) || (a < b ? -1 : 1));
      const due = cands[0]!;
      taken.add(`${it.id}|${due}`);
      out.push({ txId: tx.id, itemId: it.id, due });
      break;
    }
  }
  return out;
}

// ---------------- detection ----------------
export interface DetectRow {
  account_id: string;
  key: string;
  sign: 1 | -1;
  lump: boolean;
  date: DateStr;
  amount_minor: number;
  category_id: string | null;
}
export interface Suggestion {
  account_id: string;
  match_norm: string;
  kind: RecKind;
  amount_minor: number;
  amount_mode: 'fixed' | 'estimated';
  cadence: 'monthly' | 'bimonthly';
  day_of_month: number;
  anchor_date: DateStr;
  category_id: string | null;
  name: string;
  groupKey: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : Math.round((s[n / 2 - 1]! + s[n / 2]!) / 2);
};

/** Circular spread of days within a 31-day month. */
export function daySpread(days: number[]): number {
  const s = [...new Set(days)].sort((a, b) => a - b);
  if (s.length <= 1) return 0;
  let maxGap = 0;
  for (let i = 0; i < s.length; i++) {
    const gap = i === s.length - 1 ? s[0]! + 31 - s[i]! : s[i + 1]! - s[i]!;
    maxGap = Math.max(maxGap, gap);
  }
  return 31 - maxGap;
}

export const groupKeyOf = (r: Pick<DetectRow, 'account_id' | 'sign' | 'lump' | 'key'>) => `${r.account_id}|${r.lump ? 'card_lump' : r.sign}|${r.key}`;

/** Candidate recurring patterns from the last 6 months of non-transfer transactions (PLAN §10.2). */
export function detectRecurring(rows: DetectRow[], names: Map<string, string> = new Map()): Suggestion[] {
  const groups = new Map<string, DetectRow[]>();
  for (const r of rows) {
    const k = groupKeyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Suggestion[] = [];
  for (const [gk, g] of groups) {
    const byMonth = new Map<string, DetectRow[]>();
    for (const r of g) byMonth.set(monthOf(r.date), [...(byMonth.get(monthOf(r.date)) ?? []), r]);
    const months = [...byMonth.keys()].sort();
    const amounts = g.map((r) => Math.abs(r.amount_minor));
    const med = median(amounts);
    const relSpread = med ? (Math.max(...amounts) - Math.min(...amounts)) / med : 1;
    const consecutive2 = months.length === 2 && monthDiff(months[0]!, months[1]!) === 1 && relSpread <= 0.02;
    if (!(months.length >= 3 || consecutive2)) continue;
    const once = [...byMonth.values()].filter((v) => v.length === 1).length / months.length;
    if (once < 0.8) continue;
    if (daySpread(g.map((r) => dayOf(r.date))) > 6) continue;
    const lump = g[0]!.lump;
    if (!lump && relSpread > 0.25) continue;
    const alternating = months.length >= 3 && months.every((m, i) => i === 0 || monthDiff(months[i - 1]!, m) === 2);
    const sign = g[0]!.sign;
    const cats = new Map<string, number>();
    for (const r of g) if (r.category_id) cats.set(r.category_id, (cats.get(r.category_id) ?? 0) + 1);
    const cat = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const last = [...g].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!;
    out.push({
      account_id: g[0]!.account_id,
      match_norm: lump ? '' : g[0]!.key,
      kind: lump ? 'card_charge' : sign > 0 ? 'income' : 'expense',
      amount_minor: sign * med,
      amount_mode: relSpread <= 0.02 ? 'fixed' : 'estimated',
      cadence: alternating ? 'bimonthly' : 'monthly',
      day_of_month: median(g.map((r) => dayOf(r.date))),
      anchor_date: last.date,
      category_id: cat,
      name: names.get(gk) ?? g[0]!.key,
      groupKey: gk,
    });
  }
  return out;
}
