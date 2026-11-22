import { addDays, addMonths, daysBetween, isValidDate, MAX_RANGE_DAYS, maxDate, minDate, monthDiff } from '../../../shared/dates';
import { CALENDAR, type Cal } from '../../../shared/period';

export type Range = { from: string; to: string };
export const PRESETS = ['month', 'lastMonth', '3m', '6m', 'year', '12m'] as const;
export type Preset = (typeof PRESETS)[number];

/** Month offsets [first, last] relative to today's month. */
const OFF: Record<Preset, (m: string) => [number, number]> = {
  month: () => [0, 0],
  lastMonth: () => [-1, -1],
  '3m': () => [-2, 0],
  '6m': () => [-5, 0],
  year: (m) => [1 - Number(m.slice(5)), 0],
  '12m': () => [-11, 0],
};

/** Presets are whole statistics periods (`cal`: pay-day periods or calendar months). */
export function presetRange(p: Preset, today: string, cal: Cal = CALENDAR): Range {
  const m = cal.of(today);
  const [a, b] = OFF[p](m);
  return { from: cal.start(addMonths(m, a)), to: cal.end(addMonths(m, b)) };
}

export const presetOf = (r: Range, today: string, cal: Cal = CALENDAR): Preset | undefined =>
  PRESETS.find((p) => {
    const x = presetRange(p, today, cal);
    return x.from === r.from && x.to === r.to;
  });

/** One period back (-1) or forward (1): whole-month ranges move by their month count, others by their length in days. */
export function shiftRange(r: Range, dir: 1 | -1, cal: Cal = CALENDAR): Range {
  const fm = cal.of(r.from);
  const tm = cal.of(r.to);
  if (r.from === cal.start(fm) && r.to === cal.end(tm)) {
    const n = (monthDiff(fm, tm) + 1) * dir;
    return { from: cal.start(addMonths(fm, n)), to: cal.end(addMonths(tm, n)) };
  }
  const n = (daysBetween(r.from, r.to) + 1) * dir;
  return { from: addDays(r.from, n), to: addDays(r.to, n) };
}

/** Parses a stored choice: a preset name or "from..to". */
export function parseStored(s: string | null, today: string, cal: Cal = CALENDAR): Range | null {
  if (!s) return null;
  if ((PRESETS as readonly string[]).includes(s)) return presetRange(s as Preset, today, cal);
  const [from, to] = s.split('..');
  const r = { from: from!, to: to! };
  return validRange(r) ? r : null;
}

/** What the API accepts: real dates, from ≤ to, at most MAX_RANGE_DAYS long. */
export const validRange = (r: Range) => isValidDate(r.from) && isValidDate(r.to) && r.from <= r.to && daysBetween(r.from, r.to) < MAX_RANGE_DAYS;

/** Makes an edited range valid by moving the end that was not just edited. */
export function clampRange(r: Range, edited: 'from' | 'to'): Range {
  const max = MAX_RANGE_DAYS - 1;
  if (edited === 'from') return { from: r.from, to: r.to < r.from ? r.from : minDate(r.to, addDays(r.from, max)) };
  return { from: r.from > r.to ? r.to : maxDate(r.from, addDays(r.to, -max)), to: r.to };
}
