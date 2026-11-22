/** End-of-month forecast and lowest point (PLAN §10.3). Pure, integer agorot throughout. */
import { addDays, addMonths, daysBetween, type DateStr } from '../dates';
import { CALENDAR, type Cal } from '../period';
import { isStale } from './common';
import { occurrences, type Occurrence, type Override, type RecItem, type Settled } from './recurring';
import { norm } from '../normalize';

export interface PlannedIn {
  id: string;
  name: string;
  amount_minor: number;
  date: DateStr;
  account_id: string | null;
  card_recurring_id: string | null;
  status: 'planned' | 'done' | 'cancelled';
}
export interface ActualIn {
  id: string;
  date: DateStr;
  amount_minor: number;
  account_id: string;
  recurring_id: string | null;
  planned_id: string | null;
  /** Expense line (not transfer, not income). */
  isExpense: boolean;
  manual: boolean;
}
export interface ForecastInput {
  today: DateStr;
  asOf: DateStr;
  forecastAccountIds: string[];
  startBalance: number;
  items: RecItem[];
  overrides: Override[];
  settled: Settled[];
  planned: PlannedIn[];
  actuals: ActualIn[];
  baseline: { setting: number | null; v: number; d: number; monthOfA: { sum: number; days: number } | null };
  completeMonths: number;
  safetyBuffer: number;
  /** Extra horizon (e.g. today + 45 for the upcoming list). */
  horizonEnd?: DateStr;
  /** Budget periods (pay day); "month end" is the end of the current period. Default: calendar months. */
  cal?: Cal;
}
export type EventType = 'income' | 'recurring' | 'card' | 'planned' | 'actual';
export interface ForecastEvent {
  date: DateStr;
  label: string;
  amountMinor: number;
  type: EventType;
  itemId?: string;
  plannedId?: string;
  due?: DateStr;
  overridden?: boolean;
  late?: boolean;
}
export interface ForecastView {
  asOf: DateStr;
  today: DateStr;
  stale: boolean;
  startBalance: number;
  series: { date: DateStr; balance: number }[];
  eom: { date: DateStr; balance: number } | null;
  low: { date: DateStr; balance: number } | null;
  lowHorizon: { date: DateStr; balance: number } | null;
  afterNextCard: { date: DateStr; balance: number } | null;
  belowZero: boolean;
  belowBuffer: boolean;
  safetyBuffer: number;
  breakdown: { income: number; recurring: number; card: number; planned: number; variable: number; actuals: number };
  baselineDaily: number;
  events: ForecastEvent[];
  missed: { itemId: string; label: string; due: DateStr; amountMinor: number }[];
  overdue: { plannedId: string; label: string; date: DateStr; amountMinor: number }[];
  confidence: 'high' | 'medium' | 'low';
  lowConfidenceBaseline: boolean;
  hasForecastAccount: boolean;
  monthEvents: { positive: number; negative: number; variable: number };
}

export const LATE_DAYS = 5;
export const MISSED_LOOKBACK = 35;

/** Daily variable-spend baseline (step 5). */
export function baselineDaily(b: ForecastInput['baseline']): { daily: number; low: boolean } {
  if (b.setting !== null) return { daily: Math.round(b.setting), low: false };
  if (b.d > 0) return { daily: Math.round(b.v / b.d), low: false };
  if (b.monthOfA && b.monthOfA.days >= 10) return { daily: Math.round(b.monthOfA.sum / b.monthOfA.days), low: false };
  return { daily: 0, low: true };
}

export function computeForecast(inp: ForecastInput): ForecastView {
  const T = inp.today;
  const A = inp.asOf;
  const cal = inp.cal ?? CALENDAR;
  const EOM = cal.end(cal.of(T));
  const E0 = cal.end(addMonths(cal.of(T), 1));
  const H = inp.horizonEnd && inp.horizonEnd > E0 ? inp.horizonEnd : E0;
  const stale = isStale(T, A);
  const base: Omit<ForecastView, 'series' | 'eom' | 'low' | 'lowHorizon' | 'afterNextCard' | 'belowZero' | 'belowBuffer' | 'breakdown' | 'events' | 'missed' | 'overdue' | 'monthEvents'> = {
    asOf: A,
    today: T,
    stale,
    startBalance: inp.startBalance,
    safetyBuffer: inp.safetyBuffer,
    baselineDaily: 0,
    confidence: 'low',
    lowConfidenceBaseline: true,
    hasForecastAccount: inp.forecastAccountIds.length > 0,
  };
  const empty = { income: 0, recurring: 0, card: 0, planned: 0, variable: 0, actuals: 0 };
  if (!inp.forecastAccountIds.length)
    return { ...base, startBalance: 0, series: [], eom: null, low: null, lowHorizon: null, afterNextCard: null, belowZero: false, belowBuffer: false, breakdown: empty, events: [], missed: [], overdue: [], monthEvents: { positive: 0, negative: 0, variable: 0 } };

  const fa = new Set(inp.forecastAccountIds);
  const events: ForecastEvent[] = [];
  const missed: ForecastView['missed'] = [];
  const overdue: ForecastView['overdue'] = [];
  const A1 = addDays(A, 1);
  const place = (d: DateStr) => (d > A ? d : A1);

  // 2) known actuals after A
  const manualVar = new Map<DateStr, number>();
  for (const t of inp.actuals) {
    if (t.date <= A || t.date > H || !fa.has(t.account_id)) continue;
    events.push({ date: t.date, label: '', amountMinor: t.amount_minor, type: 'actual' });
    if (t.manual && t.isExpense && !t.recurring_id && !t.planned_id) manualVar.set(t.date, (manualVar.get(t.date) ?? 0) - t.amount_minor);
  }

  // 3) recurring occurrences
  const cardOccs = new Map<string, (Occurrence & { ev?: ForecastEvent })[]>();
  for (const it of inp.items) {
    if (it.status !== 'active') continue;
    if (it.account_id && !fa.has(it.account_id)) continue;
    const occs = occurrences(it, addDays(A, -MISSED_LOOKBACK), H, inp.overrides, inp.settled);
    const list: (Occurrence & { ev?: ForecastEvent })[] = [];
    for (const o of occs) {
      if (o.settled || o.skipped) continue;
      if (o.due < addDays(A, -LATE_DAYS)) {
        missed.push({ itemId: it.id, label: it.name, due: o.due, amountMinor: o.amountMinor });
        continue;
      }
      const type: EventType = it.kind === 'card_charge' ? 'card' : o.amountMinor > 0 ? 'income' : 'recurring';
      const ev: ForecastEvent = { date: place(o.due), label: it.name, amountMinor: o.amountMinor, type, itemId: it.id, due: o.due, overridden: o.overridden, late: o.due <= A };
      events.push(ev);
      list.push({ ...o, ev });
    }
    if (it.kind === 'card_charge') cardOccs.set(it.id, list);
  }

  // 4) planned
  for (const p of inp.planned) {
    if (p.status !== 'planned') continue;
    if (p.card_recurring_id) {
      const occ = (cardOccs.get(p.card_recurring_id) ?? []).find((o) => o.due > p.date);
      if (occ?.ev && !occ.overridden) occ.ev.amountMinor += p.amount_minor;
      continue;
    }
    if (p.account_id && !fa.has(p.account_id)) continue;
    if (p.date < addDays(A, -LATE_DAYS)) {
      overdue.push({ plannedId: p.id, label: p.name, date: p.date, amountMinor: p.amount_minor });
      continue;
    }
    if (p.date > H) continue;
    events.push({ date: place(p.date), label: p.name, amountMinor: p.amount_minor, type: 'planned', plannedId: p.id, late: p.date <= A });
  }

  // 5) variable spend
  const bd = baselineDaily(inp.baseline);
  const varOn = (d: DateStr) => Math.max(0, bd.daily - (manualVar.get(d) ?? 0));

  // 6) series
  const byDate = new Map<DateStr, number>();
  for (const e of events) if (e.date <= H) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.amountMinor);
  const series: { date: DateStr; balance: number }[] = [{ date: A, balance: inp.startBalance }];
  const breakdown = { ...empty };
  let bal = inp.startBalance;
  for (let d = A1; d <= H; d = addDays(d, 1)) {
    const v = varOn(d);
    bal += (byDate.get(d) ?? 0) - v;
    series.push({ date: d, balance: bal });
    if (d <= EOM) breakdown.variable -= v;
  }
  for (const e of events) {
    if (e.date > EOM || e.date <= A) continue;
    const k = e.type === 'actual' ? 'actuals' : e.type;
    breakdown[k] += e.amountMinor;
  }
  const at = (d: DateStr) => series.find((s) => s.date === d) ?? null;
  const minIn = (from: DateStr, to: DateStr) => {
    let best: { date: DateStr; balance: number } | null = null;
    for (const s of series) if (s.date >= from && s.date <= to && (!best || s.balance < best.balance)) best = s;
    return best;
  };
  const eom = EOM >= A ? at(EOM) : null;
  const low = minIn(T, EOM);
  const lowHorizon = minIn(T, E0);
  const nextCard = events.filter((e) => e.type === 'card' && e.date >= T).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const afterNextCard = nextCard ? at(nextCard.date) : null;
  const monthEvents = { positive: 0, negative: 0, variable: -breakdown.variable };
  for (const e of events) {
    if (e.date <= A || e.date > EOM || e.type === 'actual') continue;
    if (e.amountMinor >= 0) monthEvents.positive += e.amountMinor;
    else monthEvents.negative -= e.amountMinor;
  }

  const confidence: ForecastView['confidence'] = stale || inp.completeMonths === 0 ? 'low' : !stale && daysBetween(A, T) <= 7 && inp.completeMonths >= 3 ? 'high' : 'medium';
  return {
    ...base,
    series,
    eom,
    low,
    lowHorizon,
    afterNextCard,
    belowZero: !!low && low.balance < 0,
    belowBuffer: !!low && low.balance < inp.safetyBuffer,
    breakdown,
    baselineDaily: bd.daily,
    lowConfidenceBaseline: bd.low,
    events: events.filter((e) => e.type !== 'actual').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amountMinor - b.amountMinor)),
    missed,
    overdue,
    confidence,
    monthEvents,
  };
}

/**
 * The active recurring item a new one-time planned item most likely duplicates (it is already in the
 * forecast): same direction, and the same name or an amount within 5 %. Used to warn before saving.
 */
export function recurringTwin<T extends { name: string; kind: RecItem['kind']; amountMinor: number; status: string }>(p: { name: string; amountMinor: number; income: boolean }, items: T[]): T | null {
  const n = norm(p.name);
  const a = Math.abs(p.amountMinor);
  return (
    items.find((r) => {
      if (r.status !== 'active' || (r.kind === 'income') !== p.income) return false;
      const rn = norm(r.name);
      const ra = Math.abs(r.amountMinor);
      return (n.length >= 3 && rn.length >= 3 && (rn.includes(n) || n.includes(rn))) || (a > 0 && Math.abs(ra - a) <= ra * 0.05);
    }) ?? null
  );
}
