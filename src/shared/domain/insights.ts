/** Rule-based action items (PLAN §10.7). Params are language-neutral; the client formats them. */
import { GENERAL_ID, type BudgetLine, type OccasionalLine } from './budget';
import type { GoalView } from './goals';
import { CALENDAR, type Cal } from '../period';

export type Severity = 'alert' | 'warn' | 'info' | 'good';
export interface Insight {
  id: string;
  severity: Severity;
  key: string;
  params: Record<string, string | number>;
  href: string;
}
export interface InsightInput {
  /** Budget periods (pay day): which dates belong to `month`. Default: calendar months. */
  cal?: Cal;
  stale: boolean;
  asOf: string;
  hasForecastAccount: boolean;
  low: { date: string; balance: number } | null;
  belowBuffer: boolean;
  safetyBuffer: number;
  uncategorized60: number;
  month: string;
  isCurrentMonth: boolean;
  f: number | null;
  unsplitCardMinor: number;
  lines: BudgetLine[];
  /** Occasional categories (yearly budgets) of the month's year. */
  occasional?: OccasionalLine[];
  pace: { thisMinor: number; prevMinor: number; day: number } | null;
  suggestedCount: number;
  bigPayments: { label: string; date: string; amountMinor: number }[];
  goals: GoalView[];
  lastComplete: { month: string; savingsRate: number | null; budgeted: number; spentBudgeted: number } | null;
}
const ORDER: Record<Severity, number> = { alert: 0, warn: 1, info: 2, good: 3 };

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const add = (severity: Severity, key: string, params: Insight['params'], href: string, id = key) => out.push({ id, severity, key, params, href });
  if (i.stale) add('warn', 'stale_data', { date: i.asOf }, '/import');
  if (!i.hasForecastAccount) add('info', 'no_forecast_account', {}, '/accounts');
  if (i.low && i.low.balance < 0) add('alert', 'low_point_negative', { amountMinor: i.low.balance, date: i.low.date }, '/forecast');
  else if (i.low && i.belowBuffer) add('warn', 'low_point_buffer', { amountMinor: i.low.balance, date: i.low.date, bufferMinor: i.safetyBuffer }, '/forecast');
  if (i.uncategorized60 > 0) add('warn', 'uncategorized', { count: i.uncategorized60 }, '/transactions?uncategorized=1');
  if (i.unsplitCardMinor > 0) add('info', 'card_unsplit', { amountMinor: i.unsplitCardMinor, month: i.month }, `/transactions?kind=card_lump&from=${i.month}-01&to=${i.month}-31`);
  const over = i.lines.filter((l) => l.status === 'over').sort((a, b) => (a.remainingMinor ?? 0) - (b.remainingMinor ?? 0));
  over.slice(0, 3).forEach((l) => add('warn', 'budget_over', { category: l.name, amountMinor: -(l.remainingMinor ?? 0) }, `/budget?month=${i.month}`, `budget_over_${l.categoryId}`));
  if (over.length > 3) add('warn', 'budget_over_more', { count: over.length - 3 }, `/budget?month=${i.month}`);
  for (const l of (i.occasional ?? []).filter((x) => x.status === 'over'))
    add('warn', 'budget_over_year', { category: l.name, amountMinor: -(l.remainingMinor ?? 0), year: i.month.slice(0, 4) }, `/budget?month=${i.month}`, `budget_over_year_${l.categoryId}`);
  for (const l of i.lines) {
    if (l.avg3Minor <= 0) continue;
    let comparable: number | null = null;
    if (!i.isCurrentMonth) comparable = l.spentMinor;
    else if (i.f !== null && i.f >= 0.5) comparable = Math.round(l.spentMinor / i.f);
    if (comparable === null) continue;
    if (comparable >= 1.3 * l.avg3Minor && comparable - l.avg3Minor >= 20000) add('info', 'category_spike', { category: l.name, amountMinor: comparable, avgMinor: l.avg3Minor }, l.categoryId === GENERAL_ID ? `/budget?month=${i.month}` : `/transactions?category=${l.categoryId}`, `spike_${l.categoryId}`);
  }
  if (i.pace && i.pace.prevMinor > 0) {
    const diff = (i.pace.thisMinor - i.pace.prevMinor) / i.pace.prevMinor;
    if (Math.abs(diff) >= 0.1) add(diff > 0 ? 'info' : 'good', diff > 0 ? 'pace_more' : 'pace_less', { pct: Math.abs(diff), day: i.pace.day }, '/trends?tab=day');
  }
  if (i.suggestedCount > 0) add('info', 'recurring_suggested', { count: i.suggestedCount }, '/recurring');
  const big = i.bigPayments.filter((p) => Math.abs(p.amountMinor) >= 100000).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (big) add('info', 'payment_soon', { label: big.label, amountMinor: big.amountMinor, date: big.date }, '/upcoming');
  i.goals.filter((g) => g.status === 'behind' && !g.archived).slice(0, 2).forEach((g) => add('warn', 'goal_behind', { goal: g.name, amountMinor: g.requiredMonthlyMinor ?? 0 }, '/goals', `goal_behind_${g.id}`));
  for (const g of i.goals) {
    const m = [...g.milestones].reverse().find((x) => (i.cal ?? CALENDAR).of(x.date) === i.month);
    if (m) add('good', 'goal_milestone', { goal: g.name, pct: m.pct / 100 }, '/goals', `milestone_${g.id}`);
  }
  if (i.lastComplete?.savingsRate !== null && i.lastComplete?.savingsRate !== undefined && i.lastComplete.savingsRate >= 0.2) add('good', 'savings_good', { pct: i.lastComplete.savingsRate, month: i.lastComplete.month }, '/trends?tab=months');
  if (i.lastComplete && i.lastComplete.budgeted > 0 && i.lastComplete.spentBudgeted <= i.lastComplete.budgeted) add('good', 'under_budget', { month: i.lastComplete.month }, `/budget?month=${i.lastComplete.month}`);
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
