import type { MonthStr } from '../dates';

export interface UsualItem {
  categoryId: string;
  name: string;
  /** Average per month over the base months (months without spending count as 0). */
  avgMinor: number;
  /** avg ÷ average monthly income; null without income. */
  shareOfIncome: number | null;
  /** avg ÷ average monthly spending. */
  shareOfSpending: number;
  /** Spent so far in the shown month. */
  thisMonthMinor: number;
  /** This month already passed the usual amount. */
  over: boolean;
}

export interface UsualMonth {
  /** Complete months the averages are based on (oldest first). */
  months: MonthStr[];
  avgIncomeMinor: number;
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
  categories: Map<string, { name: string; system: boolean }>;
  limit?: number;
}): UsualMonth | null {
  const n = i.months.length;
  if (!n) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((a, x) => a + x, 0) / n);
  const avgIncomeMinor = avg(i.months.map((m) => i.pnl.get(m)?.income ?? 0));
  const avgExpensesMinor = avg(i.months.map((m) => i.pnl.get(m)?.expenses ?? 0));
  const items: UsualItem[] = [];
  // Everything in a real category, refunds included (a net-negative category still lowers spending).
  let assigned = 0;
  for (const [categoryId, byMonth] of i.spent) {
    const cat = i.categories.get(categoryId);
    if (!cat || cat.system) continue;
    const avgMinor = avg(i.months.map((m) => byMonth.get(m) ?? 0));
    assigned += avgMinor;
    if (avgMinor <= 0) continue;
    const thisMonthMinor = i.thisMonth.get(categoryId) ?? 0;
    items.push({
      categoryId,
      name: cat.name,
      avgMinor,
      shareOfIncome: avgIncomeMinor > 0 ? avgMinor / avgIncomeMinor : null,
      shareOfSpending: avgExpensesMinor > 0 ? avgMinor / avgExpensesMinor : 0,
      thisMonthMinor,
      over: thisMonthMinor > avgMinor,
    });
  }
  items.sort((a, b) => b.avgMinor - a.avgMinor || a.name.localeCompare(b.name));
  return {
    months: i.months,
    avgIncomeMinor,
    avgExpensesMinor,
    spendShareOfIncome: avgIncomeMinor > 0 ? avgExpensesMinor / avgIncomeMinor : null,
    unassignedMinor: Math.max(0, avgExpensesMinor - assigned),
    otherMinor: items.slice(i.limit ?? 6).reduce((a, x) => a + x.avgMinor, 0),
    items: items.slice(0, i.limit ?? 6),
  };
}
