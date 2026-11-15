/** Dates are 'YYYY-MM-DD' strings, months 'YYYY-MM'. All math in UTC. No date library. */
export type DateStr = string;
export type MonthStr = string;

const DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isValidDate(s: unknown): s is DateStr {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(`${m[1]}-${m[2]}`) && y >= 1900 && y <= 2200;
}
export const isValidMonth = (s: unknown): s is MonthStr => typeof s === 'string' && MONTH_RE.test(s) && Number(s.slice(5)) >= 1 && Number(s.slice(5)) <= 12;

export function toUtcMs(d: DateStr): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}
export function fromUtcMs(ms: number): DateStr {
  return new Date(ms).toISOString().slice(0, 10);
}
export const addDays = (d: DateStr, n: number): DateStr => fromUtcMs(toUtcMs(d) + n * DAY);
/** b − a in whole days. */
export const daysBetween = (a: DateStr, b: DateStr): number => Math.round((toUtcMs(b) - toUtcMs(a)) / DAY);
export const monthOf = (d: DateStr): MonthStr => d.slice(0, 7);
export const dayOf = (d: DateStr): number => Number(d.slice(8, 10));
/** 0 = Sunday. */
export const dayOfWeek = (d: DateStr): number => new Date(toUtcMs(d)).getUTCDay();
/** Longest date range (in days, inclusive) the trends views accept. */
export const MAX_RANGE_DAYS = 1100;

export function daysInMonth(m: MonthStr): number {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
export const monthStart = (m: MonthStr): DateStr => `${m}-01`;
export const monthEnd = (m: MonthStr): DateStr => `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;

export function addMonths(m: MonthStr, n: number): MonthStr {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mo / 12);
  const mm = ((mo % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}
/** Number of months from a to b (b − a). */
export const monthDiff = (a: MonthStr, b: MonthStr): number =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/** Day `day` of month m, clamped to the month length. */
export const clampDay = (m: MonthStr, day: number): DateStr =>
  `${m}-${String(Math.min(Math.max(1, day), daysInMonth(m))).padStart(2, '0')}`;

export const minDate = (a: DateStr, b: DateStr): DateStr => (a < b ? a : b);
export const maxDate = (a: DateStr, b: DateStr): DateStr => (a > b ? a : b);

/** Today in an IANA timezone as YYYY-MM-DD. */
export function todayInTz(timeZone: string, now: Date = new Date()): DateStr {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Excel 1900-system serial → date (1899-12-30 + n days). */
export function excelSerialToDate(n: number): DateStr | null {
  if (!Number.isFinite(n) || n < 1 || n > 120000) return null;
  return fromUtcMs(Date.UTC(1899, 11, 30) + Math.floor(n) * DAY);
}

/** Months in [from, to] inclusive, ascending. */
export function monthRange(from: MonthStr, to: MonthStr): MonthStr[] {
  const out: MonthStr[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** First day of week: 0 = Sunday. Israel (both locales) starts on Sunday. */
export const weekStartsOn = (_locale: 'en' | 'he'): 0 | 1 => 0;
