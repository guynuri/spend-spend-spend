import type { MonthStr } from '../../../shared/dates';
import { monthRange } from '../../../shared/dates';
import { elapsedFraction, lastCompleteMonths, mean } from '../../../shared/domain/common';
import { buildBudgetView, generalName, GENERAL_ID, limitFor, monthlyBudgetLines, type BudgetCategoryIn, type BudgetMode, type BudgetRow, type BudgetView, type YearlyBudgetRow } from '../../../shared/domain/budget';
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
  // 12 months back covers January of M's year (year to date) and the occasional 12-month totals
  const from = [monthsBack(month, Math.max(historyMonths - 1, 11)), ...avgMonths, ...incomeMonths].sort()[0]!;
  const [cats, budgets, general, yearly, spent, pnl, unsplit] = await q.batch([
    q.stmt("SELECT id, name, grp, archived, budget_mode FROM categories WHERE household_id = ?1 AND kind = 'expense' AND parent_id IS NULL ORDER BY sort, name"),
    q.stmt('SELECT category_id, effective_from, limit_minor, one_time FROM budgets WHERE household_id = ?1'),
    q.stmt(`SELECT '${GENERAL_ID}' AS category_id, effective_from, limit_minor, one_time FROM general_budgets WHERE household_id = ?1`),
    q.stmt('SELECT category_id, year, limit_minor FROM yearly_budgets WHERE household_id = ?1'),
    spentByCategoryStmt(q, base.cal, from, month),
    pnlByMonthStmt(q, base.cal, from, month),
    unsplitCardStmt(q, base.cal, month),
  ]);
  const categories: BudgetCategoryIn[] = (cats!.results as { id: string; name: string; grp: 'fixed' | 'variable' | null; archived: number; budget_mode: BudgetMode }[]).map((c) => ({
    id: c.id,
    name: c.name,
    grp: c.grp,
    archived: c.archived === 1,
    mode: c.budget_mode,
  }));
  const rows = budgets!.results as unknown as BudgetRow[];
  const generalRows = general!.results as unknown as BudgetRow[];
  const yearlyRows = yearly!.results as unknown as YearlyBudgetRow[];
  const byCat = toSpentMaps(spent);
  const sumOver = (cid: string, first: MonthStr) => [...(byCat.get(cid) ?? new Map<string, number>()).entries()].reduce((a, [m, v]) => (m >= first && m <= month ? a + v : a), 0);
  const occ = categories.filter((c) => c.mode === 'occasional');
  const pnlMap = toPnlMap(pnl);
  const spentM = new Map([...byCat.entries()].map(([cid, mm]) => [cid, mm.get(month) ?? 0]));
  const view = buildBudgetView({
    month,
    f: elapsedFraction(month, base.today, base.asOf, base.cal),
    categories,
    budgets: rows,
    spent: spentM,
    history: byCat,
    avgMonths,
    expensesMinor: pnlMap.get(month)?.expenses ?? 0,
    avgIncomeMinor: Math.round(mean(incomeMonths.map((m) => pnlMap.get(m)?.income ?? 0))),
    incomeMonths,
    unsplitCardMinor: (unsplit!.results[0] as { s: number }).s ?? 0,
    generalBudgets: generalRows,
    yearlyBudgets: yearlyRows,
    ytd: new Map(occ.map((c) => [c.id, sumOver(c.id, `${month.slice(0, 4)}-01`)])),
    last12: new Map(occ.map((c) => [c.id, sumOver(c.id, monthsBack(month, 11))])),
    generalName: generalName(base.locale),
  });
  const hist = monthRange(monthsBack(month, historyMonths - 1), month);
  const spentOf = (cid: string, m: MonthStr) => byCat.get(cid)?.get(m) ?? 0;
  const history = hist.map((m) => {
    const ls = monthlyBudgetLines(categories, rows, generalRows, spentOf, m);
    return { month: m, budgetedMinor: ls.reduce((a, l) => a + l.limit, 0), spentBudgetedMinor: ls.reduce((a, l) => a + l.spent, 0), expensesMinor: pnlMap.get(m)?.expenses ?? 0 };
  });
  const categoryHistory: Record<string, { month: MonthStr; spentMinor: number; limitMinor: number | null }[]> = {};
  for (const c of categories) categoryHistory[c.id] = hist.map((m) => ({ month: m, spentMinor: spentOf(c.id, m), limitMinor: c.mode === 'monthly' || !c.mode ? limitFor(rows, c.id, m) : null }));
  const generals = categories.filter((c) => c.mode === 'general');
  categoryHistory[GENERAL_ID] = hist.map((m) => ({ month: m, spentMinor: generals.reduce((a, c) => a + spentOf(c.id, m), 0), limitMinor: limitFor(generalRows, GENERAL_ID, m) }));
  // occasional: the last 12 months, so the sheet shows the year's rhythm
  const occHist = monthRange(monthsBack(month, 11), month);
  for (const c of occ) categoryHistory[c.id] = occHist.map((m) => ({ month: m, spentMinor: spentOf(c.id, m), limitMinor: null }));
  return { ...view, history, categoryHistory };
}
