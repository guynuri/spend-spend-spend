import type { MonthStr } from '../dates';
import { GENERAL_ID, GENERAL_NAME, type BudgetMode } from './budget';

export interface UsualItem {
  /** A category id, or GENERAL_ID for all general expenses together. */
  categoryId: string;
  name: string;
  /** 'general': the pooled general expenses; 'occasional': averaged over `occasionalMonths` (up to 12). */
  kind?: 'general' | 'occasional';
  /** Average per month over the base months (months without spending count as 0). */
  avgMinor: number;
  /** avg ÷ average monthly income; null without income. */
  shareOfIncome: number | null;
  /** avg ÷ average monthly spending. */
  shareOfSpending: number;
  /** Spent so far in the shown month. */
  thisMonthMinor: number;
  /** This month already passed the usual amount (never for occasional spending: it comes in lumps). */
  over: boolean;
}

export interface UsualMonth {
  /** Complete months the averages are based on (oldest first). */
  months: MonthStr[];
  /** Complete months occasional categories are averaged over (up to 12, oldest first). */
  occasionalMonths: MonthStr[];
  avgIncomeMinor: number;
  /** Usual monthly spending: everyday spending over `months` + occasional spending spread over `occasionalMonths`. */
  avgExpensesMinor: number;
  /** avg spending ÷ avg income; null without income. */
  spendShareOfIncome: number | null;
  /** Average monthly spending not in any listed kind of category: uncategorized or unsplit card charges. */
  unassignedMinor: number;
  /** Average monthly spending in categories past the listed ones. */
  otherMinor: number;
  items: UsualItem[];
}

/**
 * "A usual month": average income, spending and spending per category over recent complete months,
 * with the shown month so far next to it. Only months that have data count (a household that started
 * two months ago is averaged over two). System categories (unsplit card charges) are left out of the
 * list: they are a placeholder, not a kind of spending. Sorted by average, largest first.
 */
export function usualMonth(i: {
  months: MonthStr[];
  pnl: Map<string, { income: number; expenses: number }>;
  /** category → month → spent (expense categories). */
  spent: Map<string, Map<string, number>>;
  thisMonth: Map<string, number>;
  categories: Map<string, { name: string; system: boolean; mode?: BudgetMode }>;
  /** Complete months to average occasional categories over (default: `months`). */
  occasionalMonths?: MonthStr[];
  generalName?: string;
  limit?: number;
}): UsualMonth | null {
  const n = i.months.length;
  if (!n) return null;
  const occMonths = i.occasionalMonths?.length ? i.occasionalMonths : i.months;
  const avgOver = (ms: MonthStr[], f: (m: MonthStr) => number) => Math.round(ms.reduce((a, m) => a + f(m), 0) / ms.length);
  const spentIn = (cid: string, m: MonthStr) => i.spent.get(cid)?.get(m) ?? 0;
  const occIds = [...i.categories.entries()].filter(([, c]) => c.mode === 'occasional').map(([id]) => id);
  const occIn = (m: MonthStr) => occIds.reduce((a, id) => a + spentIn(id, m), 0);
  const avgIncomeMinor = avgOver(i.months, (m) => i.pnl.get(m)?.income ?? 0);
  // everyday spending over the base months, occasional spending spread over its (longer) window
  const avgOccasional = avgOver(occMonths, occIn);
  const avgExpensesMinor = avgOver(i.months, (m) => (i.pnl.get(m)?.expenses ?? 0) - occIn(m)) + avgOccasional;
  const items: UsualItem[] = [];
  const item = (categoryId: string, name: string, avgMinor: number, thisMonthMinor: number, kind?: UsualItem['kind']): UsualItem => ({
    categoryId,
    name,
    ...(kind ? { kind } : {}),
    avgMinor,
    shareOfIncome: avgIncomeMinor > 0 ? avgMinor / avgIncomeMinor : null,
    shareOfSpending: avgExpensesMinor > 0 ? avgMinor / avgExpensesMinor : 0,
    thisMonthMinor,
    over: kind !== 'occasional' && thisMonthMinor > avgMinor,
  });
  // Everything in a real category, refunds included (a net-negative category still lowers spending).
  let assigned = 0;
  let general = 0;
  let generalNow = 0;
  let hasGeneral = false;
  for (const [categoryId, byMonth] of i.spent) {
    const cat = i.categories.get(categoryId);
    if (!cat || cat.system) continue;
    const occasional = cat.mode === 'occasional';
    const avgMinor = avgOver(occasional ? occMonths : i.months, (m) => byMonth.get(m) ?? 0);
    assigned += avgMinor;
    const thisMonthMinor = i.thisMonth.get(categoryId) ?? 0;
    if (cat.mode === 'general') {
      hasGeneral = true;
      general += avgMinor;
      generalNow += thisMonthMinor;
      continue;
    }
    if (avgMinor <= 0) continue;
    items.push(item(categoryId, cat.name, avgMinor, thisMonthMinor, occasional ? 'occasional' : undefined));
  }
  if (hasGeneral && general > 0) items.push(item(GENERAL_ID, i.generalName ?? GENERAL_NAME.en, general, generalNow, 'general'));
  items.sort((a, b) => b.avgMinor - a.avgMinor || a.name.localeCompare(b.name));
  return {
    months: i.months,
    occasionalMonths: occMonths,
    avgIncomeMinor,
    avgExpensesMinor,
    spendShareOfIncome: avgIncomeMinor > 0 ? avgExpensesMinor / avgIncomeMinor : null,
    unassignedMinor: Math.max(0, avgExpensesMinor - assigned),
    otherMinor: items.slice(i.limit ?? 6).reduce((a, x) => a + x.avgMinor, 0),
    items: items.slice(0, i.limit ?? 6),
  };
}
