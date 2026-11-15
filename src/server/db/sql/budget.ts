import type { MonthStr } from '../../../shared/dates';
import { monthRange } from '../../../shared/dates';
import { elapsedFraction, lastCompleteMonths, mean } from '../../../shared/domain/common';
import { buildBudgetView, limitFor, type BudgetRow, type BudgetView } from '../../../shared/domain/budget';
import type { TenantDb } from '../tenant';
import { monthsBack, pnlByMonthStmt, spentByCategoryStmt, toPnlMap, toSpentMaps, unsplitCardStmt, type BaseFacts } from './facts';

export interface BudgetHistoryPoint {
  month: MonthStr;
  budgetedMinor: number;
  spentBudgetedMinor: number;
  expensesMinor: number;
}

/** The single function behind the Budget page, dashboard summary, badges and health (AC5.4). */
export async function computeBudget(q: TenantDb, base: BaseFacts, month: MonthStr, historyMonths = 6): Promise<BudgetView & { history: BudgetHistoryPoint[]; categoryHistory: Record<string, { month: MonthStr; spentMinor: number; limitMinor: number | null }[]> }> {
  const avgMonths = lastCompleteMonths(base.complete, 3, month);
  const incomeMonths = lastCompleteMonths(base.complete, 3);
  const from = [monthsBack(month, historyMonths - 1), ...avgMonths, ...incomeMonths].sort()[0]!;
  const [cats, budgets, spent, pnl, unsplit] = await q.batch([
    q.stmt("SELECT id, name, grp, archived FROM categories WHERE household_id = ?1 AND kind = 'expense' ORDER BY sort, name"),
    q.stmt('SELECT category_id, effective_from, limit_minor FROM budgets WHERE household_id = ?1'),
    spentByCategoryStmt(q, from, month),
    pnlByMonthStmt(q, from, month),
    unsplitCardStmt(q, month),
  ]);
  const categories = (cats!.results as { id: string; name: string; grp: 'fixed' | 'variable' | null; archived: number }[]).map((c) => ({ ...c, archived: c.archived === 1 }));
  const rows = budgets!.results as unknown as BudgetRow[];
  const byCat = toSpentMaps(spent);
  const pnlMap = toPnlMap(pnl);
  const spentM = new Map([...byCat.entries()].map(([cid, mm]) => [cid, mm.get(month) ?? 0]));
  const view = buildBudgetView({
    month,
    f: elapsedFraction(month, base.today, base.asOf),
    categories,
    budgets: rows,
    spent: spentM,
    history: byCat,
    avgMonths,
    expensesMinor: pnlMap.get(month)?.expenses ?? 0,
    avgIncomeMinor: Math.round(mean(incomeMonths.map((m) => pnlMap.get(m)?.income ?? 0))),
    incomeMonths,
    unsplitCardMinor: (unsplit!.results[0] as { s: number }).s ?? 0,
  });
  const hist = monthRange(monthsBack(month, historyMonths - 1), month);
  const history = hist.map((m) => {
    let b = 0;
    let s = 0;
    for (const c of categories) {
      const l = limitFor(rows, c.id, m);
      if (l !== null) {
        b += l;
        s += byCat.get(c.id)?.get(m) ?? 0;
      }
    }
    return { month: m, budgetedMinor: b, spentBudgetedMinor: s, expensesMinor: pnlMap.get(m)?.expenses ?? 0 };
  });
  const categoryHistory: Record<string, { month: MonthStr; spentMinor: number; limitMinor: number | null }[]> = {};
  for (const c of categories) categoryHistory[c.id] = hist.map((m) => ({ month: m, spentMinor: byCat.get(c.id)?.get(m) ?? 0, limitMinor: limitFor(rows, c.id, m) }));
  return { ...view, history, categoryHistory };
}
