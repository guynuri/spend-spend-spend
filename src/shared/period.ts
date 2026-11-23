/**
 * Budget periods ("months") that start on a chosen day — pay day (D-R23).
 *
 * A household picks a start day 1–28 (≤ 28 so every month has it). A period is labelled with a month
 * ('YYYY-MM') so everything that keys data by month keeps working:
 *   - start day ≤ 15: the period is labelled with the month it starts in (10 Nov – 9 Dec = "2026-11");
 *   - start day > 15: with the month it mostly covers (25 Oct – 24 Nov = "2026-11").
 * Start day 1 is exactly the calendar month, with the same SQL as before.
 */
import { addDays, addMonths, clampDay, daysBetween, monthOf, type DateStr, type MonthStr } from './dates';

export interface Cal {
  /** First day of every period (1 = calendar months). */
  readonly day: number;
  /** The period a date falls in. */
  of(d: DateStr): MonthStr;
  start(m: MonthStr): DateStr;
  end(m: MonthStr): DateStr;
  /** Days in the period. */
  days(m: MonthStr): number;
  /** 1-based day of the date within its period. */
  dayIn(d: DateStr): number;
  /** SQL expression giving the period label of a date column. */
  sql(col: string): string;
}

export const MIN_START_DAY = 1;
export const MAX_START_DAY = 28;
export const isStartDay = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_START_DAY && (n as number) <= MAX_START_DAY;

export function makeCal(day = 1): Cal {
  const d = isStartDay(day) ? day : 1;
  const late = d > 15;
  const start = (m: MonthStr) => clampDay(late ? addMonths(m, -1) : m, d);
  const of = (x: DateStr) => {
    const m = monthOf(addDays(x, -(d - 1)));
    return late ? addMonths(m, 1) : m;
  };
  const end = (m: MonthStr) => addDays(start(addMonths(m, 1)), -1);
  return {
    day: d,
    of,
    start,
    end,
    days: (m) => daysBetween(start(m), end(m)) + 1,
    dayIn: (x) => daysBetween(start(of(x)), x) + 1,
    sql: (col) =>
      d === 1 ? `substr(${col}, 1, 7)` : late ? `strftime('%Y-%m', date(${col}, '-${d - 1} days', 'start of month', '+1 month'))` : `strftime('%Y-%m', ${col}, '-${d - 1} days')`,
  };
}

/** Calendar months. */
export const CALENDAR = makeCal(1);
