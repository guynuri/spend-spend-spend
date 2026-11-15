/** Budget math (PLAN §10.4). Pure; inputs are SQL aggregates. */
import type { MonthStr } from '../dates';
import { mean } from './common';

export interface BudgetRow {
  category_id: string;
  effective_from: MonthStr;
  limit_minor: number | null;
}
export interface BudgetCategoryIn {
  id: string;
  name: string;
  grp: 'fixed' | 'variable' | null;
  archived: boolean;
}
export type BudgetStatus = 'over' | 'watch' | 'on_pace';

/** limit(category, M) = row with greatest effective_from ≤ M; none or NULL → unbudgeted. */
export function limitFor(rows: BudgetRow[], categoryId: string, month: MonthStr): number | null {
  let best: BudgetRow | null = null;
  for (const r of rows) if (r.category_id === categoryId && r.effective_from <= month && (!best || r.effective_from > best.effective_from)) best = r;
  return best?.limit_minor ?? null;
}

export function utilization(spent: number, limit: number): number {
  if (limit === 0) return spent > 0 ? Infinity : 0;
  return spent / limit;
}

export function budgetStatus(spent: number, limit: number, grp: 'fixed' | 'variable' | null, f: number | null): BudgetStatus | null {
  if (spent > limit) return 'over';
  if (f === null) return null;
  const u = utilization(spent, limit);
  if (grp === 'variable' && (u >= 0.9 || (u >= 0.5 && u > f + 0.1))) return 'watch';
  return 'on_pace';
}

export interface BudgetLine {
  categoryId: string;
  name: string;
  grp: 'fixed' | 'variable' | null;
  limitMinor: number | null;
  spentMinor: number;
  remainingMinor: number | null;
  utilization: number | null;
  status: BudgetStatus | null;
  avg3Minor: number;
}
export interface BudgetView {
  month: MonthStr;
  f: number | null;
  lines: BudgetLine[];
  totals: {
    budgetedMinor: number;
    spentBudgetedMinor: number;
    pctSpent: number | null;
    pace: 'ahead' | 'under' | 'on_pace' | null;
    unbudgetedSpentMinor: number;
    expensesMinor: number;
    counts: Record<BudgetStatus, number>;
    fixed: { budgetedMinor: number; spentMinor: number };
    variable: { budgetedMinor: number; spentMinor: number };
  };
  allocation: { budgetedMinor: number; avgIncomeMinor: number; months: MonthStr[] };
  unsplitCardMinor: number;
}

export function buildBudgetView(input: {
  month: MonthStr;
  f: number | null;
  categories: BudgetCategoryIn[];
  budgets: BudgetRow[];
  /** −Σ amount of expense-category lines in M, per category. */
  spent: Map<string, number>;
  /** Monthly spent per category for the avg3 months. */
  history: Map<string, Map<MonthStr, number>>;
  avgMonths: MonthStr[];
  /** Expenses(M) per §10.1 (incl. uncategorized outflows). */
  expensesMinor: number;
  avgIncomeMinor: number;
  incomeMonths: MonthStr[];
  unsplitCardMinor: number;
}): BudgetView {
  const lines: BudgetLine[] = [];
  const counts: Record<BudgetStatus, number> = { over: 0, watch: 0, on_pace: 0 };
  const fixed = { budgetedMinor: 0, spentMinor: 0 };
  const variable = { budgetedMinor: 0, spentMinor: 0 };
  let budgeted = 0;
  let spentBudgeted = 0;
  for (const c of input.categories) {
    const limit = limitFor(input.budgets, c.id, input.month);
    const spent = input.spent.get(c.id) ?? 0;
    if (c.archived && limit === null && spent === 0) continue;
    const avg3 = Math.round(mean(input.avgMonths.map((m) => input.history.get(c.id)?.get(m) ?? 0)));
    const status = limit === null ? null : budgetStatus(spent, limit, c.grp, input.f);
    if (status) counts[status]++;
    if (limit !== null) {
      budgeted += limit;
      spentBudgeted += spent;
      const g = c.grp === 'fixed' ? fixed : variable;
      g.budgetedMinor += limit;
      g.spentMinor += spent;
    }
    lines.push({ categoryId: c.id, name: c.name, grp: c.grp, limitMinor: limit, spentMinor: spent, remainingMinor: limit === null ? null : limit - spent, utilization: limit === null ? null : utilization(spent, limit), status, avg3Minor: avg3 });
  }
  const pctSpent = budgeted > 0 ? spentBudgeted / budgeted : null;
  const f = input.f;
  const pace = pctSpent === null || f === null ? null : pctSpent > f + 0.05 ? 'ahead' : pctSpent < f - 0.05 ? 'under' : 'on_pace';
  return {
    month: input.month,
    f,
    lines,
    totals: { budgetedMinor: budgeted, spentBudgetedMinor: spentBudgeted, pctSpent, pace, unbudgetedSpentMinor: input.expensesMinor - spentBudgeted, expensesMinor: input.expensesMinor, counts, fixed, variable },
    allocation: { budgetedMinor: budgeted, avgIncomeMinor: input.avgIncomeMinor, months: input.incomeMonths },
    unsplitCardMinor: input.unsplitCardMinor,
  };
}
