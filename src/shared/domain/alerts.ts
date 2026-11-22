/**
 * Gentle budget alerts and the weekly recap (D-R27): pure, so the cron and the tests share them.
 */
import { addDays, type DateStr, type MonthStr } from '../dates';

export interface AlertLine {
  categoryId: string;
  name: string;
  limitMinor: number | null;
  spentMinor: number;
}
export interface AlertMarks {
  month: MonthStr;
  keys: string[];
}
export interface BudgetAlert {
  categoryId: string;
  name: string;
  level: 80 | 100;
  /** Left (≥ 0) or over (< 0) the limit. */
  remainingMinor: number;
}

export const ALERT_LEVELS = [0.8, 1] as const;

/**
 * Budgets that crossed 80 % or 100 % of their limit since the last check this period. A line that jumped
 * straight past 100 % gets one alert (the 100 % one) and both thresholds are marked. Marks reset when the
 * period changes. Returns the new alerts (most serious first) and the marks to store.
 */
export function newBudgetAlerts(lines: AlertLine[], month: MonthStr, prev: AlertMarks | null): { alerts: BudgetAlert[]; marks: AlertMarks } {
  const seen = new Set(prev && prev.month === month ? prev.keys : []);
  const alerts: BudgetAlert[] = [];
  for (const l of lines) {
    if (!l.limitMinor || l.limitMinor <= 0) continue;
    const u = l.spentMinor / l.limitMinor;
    const level: 80 | 100 | null = u >= 1 ? 100 : u >= 0.8 ? 80 : null;
    if (!level) continue;
    const key = `${l.categoryId}:${level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (level === 100) seen.add(`${l.categoryId}:80`);
    alerts.push({ categoryId: l.categoryId, name: l.name, level, remainingMinor: l.limitMinor - l.spentMinor });
  }
  alerts.sort((a, b) => b.level - a.level || a.remainingMinor - b.remainingMinor);
  return { alerts, marks: { month, keys: [...seen].sort() } };
}

export const parseMarks = (s: string | null): AlertMarks | null => {
  try {
    const v = JSON.parse(s ?? 'null') as AlertMarks | null;
    return v && typeof v.month === 'string' && Array.isArray(v.keys) ? v : null;
  } catch {
    return null;
  }
};

/** The 7 days before `today` (the recap day itself isn't over yet) and the 7 before those. */
export function recapWeek(today: DateStr) {
  return { from: addDays(today, -7), to: addDays(today, -1), prevFrom: addDays(today, -14), prevTo: addDays(today, -8) };
}

export interface WeekRecap {
  from: DateStr;
  to: DateStr;
  spentMinor: number;
  prevSpentMinor: number;
  /** Biggest categories of the week (spending, positive). */
  top: { categoryId: string | null; spentMinor: number }[];
  /** What's left in this period's budgets; null without budgets. */
  leftMinor: number | null;
}

/** One short line for the push: what the week cost, vs the week before, and what's left. */
export function recapLine(r: WeekRecap, fmt: (minor: number) => string, locale: string | null): string {
  const he = locale === 'he';
  const diff = r.spentMinor - r.prevSpentMinor;
  const vs = r.prevSpentMinor > 0 && diff !== 0 ? (he ? ` (${fmt(Math.abs(diff))} ${diff < 0 ? 'פחות' : 'יותר'} משבוע שעבר)` : ` (${fmt(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than the week before)`) : '';
  const left = r.leftMinor === null ? '' : r.leftMinor >= 0 ? (he ? ` · נשארו ${fmt(r.leftMinor)} החודש` : ` · ${fmt(r.leftMinor)} left this month`) : he ? ` · ${fmt(-r.leftMinor)} מעבר לתקציב` : ` · ${fmt(-r.leftMinor)} over budget`;
  return he ? `השבוע הוצאתם ${fmt(r.spentMinor)}${vs}${left}` : `You spent ${fmt(r.spentMinor)} this week${vs}${left}`;
}

/** One short line for a budget alert push (one alert, or a count when several came at once). */
export function alertText(alerts: BudgetAlert[], fmt: (minor: number) => string, locale: string | null): { title: string; body: string } {
  const he = locale === 'he';
  const a = alerts[0]!;
  if (alerts.length > 1)
    return he
      ? { title: `${alerts.length} תקציבים כדאי להציץ בהם`, body: alerts.map((x) => x.name).join(' · ') }
      : { title: `${alerts.length} budgets worth a look`, body: alerts.map((x) => x.name).join(' · ') };
  if (a.level === 100)
    return he
      ? { title: `${a.name}: התקציב נגמר`, body: a.remainingMinor < 0 ? `${fmt(-a.remainingMinor)} מעבר לתקציב` : 'הגעתם לסכום שתכננתם' }
      : { title: `${a.name}: budget used up`, body: a.remainingMinor < 0 ? `${fmt(-a.remainingMinor)} over the budget` : 'You’ve reached what you planned' };
  return he ? { title: `${a.name}: 80% מהתקציב`, body: `נשארו ${fmt(a.remainingMinor)} לחודש הזה` } : { title: `${a.name}: 80% of the budget`, body: `${fmt(a.remainingMinor)} left for this month` };
}
