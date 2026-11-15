/** Definitions used by every metric (PLAN §10.1) — defined once, here. */
import { addMonths, daysBetween, daysInMonth, dayOf, monthEnd, monthOf, type DateStr, type MonthStr } from '../dates';

/** As-of date A: latest snapshot / imported transaction date of forecast accounts, capped at T; none → T. */
export function asOfDate(today: DateStr, latestSnapshot: DateStr | null, latestImported: DateStr | null): DateStr {
  const c = [latestSnapshot, latestImported].filter((x): x is string => !!x).sort();
  const a = c[c.length - 1];
  if (!a) return today;
  return a > today ? today : a;
}

export const STALE_DAYS = 35;
export const isStale = (today: DateStr, asOf: DateStr) => daysBetween(asOf, today) > STALE_DAYS;

/**
 * "Complete" months: months that contain ≥ 1 transaction and are before month(A) or fully covered
 * (month end ≤ A). Returned ascending.
 */
export function completeMonths(monthsWithTx: MonthStr[], asOf: DateStr): MonthStr[] {
  const am = monthOf(asOf);
  return [...new Set(monthsWithTx)].filter((m) => m < am || monthEnd(m) <= asOf).sort();
}

/** The up-to-3 most recent complete months strictly before `before` (default: no bound). */
export function lastCompleteMonths(complete: MonthStr[], n = 3, before?: MonthStr): MonthStr[] {
  return complete.filter((m) => !before || m < before).slice(-n);
}

/** Elapsed fraction f of month M (PLAN §10.4); null = "no data yet" in the current month. */
export function elapsedFraction(month: MonthStr, today: DateStr, asOf: DateStr): number | null {
  const cur = monthOf(today);
  if (month < cur) return 1;
  if (month > cur) return 0;
  if (monthOf(asOf) !== cur) return null;
  const d = asOf < today ? asOf : today;
  return dayOf(d) / daysInMonth(month);
}

/** Displayed month (AC11.3): current month if it has transactions, else the month of the latest data. */
export function displayMonth(today: DateStr, latestTxDate: DateStr | null): { month: MonthStr; isLatestData: boolean } {
  const cur = monthOf(today);
  if (!latestTxDate || monthOf(latestTxDate) >= cur) return { month: cur, isLatestData: false };
  return { month: monthOf(latestTxDate), isLatestData: true };
}

export const prevMonth = (m: MonthStr) => addMonths(m, -1);
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
