import { addMonths, minDate, monthEnd, monthRange, monthStart, type MonthStr } from '../../../shared/dates';
import { lastCompleteMonths, mean } from '../../../shared/domain/common';
import { limitFor, type BudgetRow } from '../../../shared/domain/budget';
import { goalView, goalsSummary, type ContributionIn, type GoalIn, type GoalView } from '../../../shared/domain/goals';
import { computeHealth, recommendations, type HealthInput, type HealthResult, type Recommendation } from '../../../shared/domain/health';
import type { TenantDb } from '../tenant';
import { pnlByMonthStmt, spentByCategoryStmt, toPnlMap, toSpentMaps, type BaseFacts } from './facts';

/** Liquid funds (Σ max(0, balance) of is_liquid accounts) at several dates, in one query. */
export function liquidAtStmt(q: TenantDb, dates: string[]) {
  return q.stmt(
    `WITH d AS (SELECT value AS dt FROM json_each(?2)),
          a AS (SELECT id, opening_balance_minor AS ob, opening_date AS od FROM accounts WHERE household_id = ?1 AND is_liquid = 1 AND archived = 0),
          s AS (SELECT d.dt, a.id, a.ob, a.od,
                       (SELECT b.date FROM account_balances b WHERE b.household_id = ?1 AND b.account_id = a.id AND b.date <= d.dt ORDER BY b.date DESC LIMIT 1) AS sd
                  FROM d, a)
     SELECT s.dt, SUM(max(0, CASE WHEN s.sd IS NOT NULL THEN
               (SELECT b.balance_minor FROM account_balances b WHERE b.household_id = ?1 AND b.account_id = s.id AND b.date = s.sd)
               + COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.household_id = ?1 AND t.account_id = s.id AND t.date > s.sd AND t.date <= s.dt), 0)
             ELSE s.ob + COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.household_id = ?1 AND t.account_id = s.id AND (s.od IS NULL OR t.date >= s.od) AND t.date <= s.dt), 0) END)) AS liquid
       FROM s GROUP BY s.dt`,
    JSON.stringify(dates),
  );
}

export interface HealthMonth {
  month: MonthStr;
  input: HealthInput;
  result: HealthResult;
  goals: GoalView[];
}
export interface HealthBundle {
  months: HealthMonth[];
  current: HealthMonth;
  change: number | null;
  recommendations: Recommendation[];
  goals: GoalView[];
  goalsSummary: ReturnType<typeof goalsSummary>;
  pnl: Map<string, { income: number; expenses: number }>;
}

/** Health inputs for each of the last `n` months up to `toMonth`, with few queries (PLAN §10.6). */
export async function healthBundle(q: TenantDb, base: BaseFacts, toMonth: MonthStr, n = 6): Promise<HealthBundle> {
  const months = monthRange(addMonths(toMonth, -(n - 1)), toMonth);
  const from = addMonths(months[0]!, -2);
  const ends = months.map((m) => minDate(monthEnd(m), base.today));
  const [pnl, debt, liquid, budgets, spent, goals, contribs, liquidCount] = await q.batch([
    pnlByMonthStmt(q, from, toMonth),
    q.stmt(
      `SELECT substr(l.date, 1, 7) AS m, -SUM(l.amount_minor) AS debt FROM v_lines l JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND c.is_debt = 1 AND c.kind = 'expense' AND l.date >= ?2 AND l.date <= ?3 GROUP BY m`,
      monthStart(from),
      monthEnd(toMonth),
    ),
    liquidAtStmt(q, ends),
    q.stmt('SELECT category_id, effective_from, limit_minor, one_time FROM budgets WHERE household_id = ?1'),
    spentByCategoryStmt(q, months[0]!, toMonth),
    q.stmt("SELECT * FROM goals WHERE household_id = ?1 AND status <> 'archived' ORDER BY priority, created_at"),
    q.stmt('SELECT goal_id, date, amount_minor FROM goal_contributions WHERE household_id = ?1'),
    q.stmt('SELECT COUNT(*) AS n FROM accounts WHERE household_id = ?1 AND is_liquid = 1 AND archived = 0'),
  ]);
  const p = toPnlMap(pnl);
  const debtMap = new Map((debt!.results as { m: string; debt: number }[]).map((r) => [r.m, r.debt]));
  const liqMap = new Map((liquid!.results as { dt: string; liquid: number }[]).map((r) => [r.dt, r.liquid]));
  const hasLiquid = ((liquidCount!.results[0] as { n: number }).n ?? 0) > 0;
  const rows = budgets!.results as unknown as BudgetRow[];
  const byCat = toSpentMaps(spent);
  const gs = goals!.results as unknown as GoalIn[];
  const cs = contribs!.results as unknown as ContributionIn[];
  const out: HealthMonth[] = months.map((m, i) => {
    const window = [addMonths(m, -2), addMonths(m, -1), m].filter((x) => base.complete.includes(x));
    const income = window.reduce((s, x) => s + (p.get(x)?.income ?? 0), 0);
    const expenses = window.reduce((s, x) => s + (p.get(x)?.expenses ?? 0), 0);
    let ok = 0;
    let total = 0;
    let over = 0;
    let budgeted = 0;
    let spentB = 0;
    const cats = new Set(rows.map((r) => r.category_id));
    for (const c of cats) {
      const l = limitFor(rows, c, m);
      if (l === null) continue;
      total++;
      const s = byCat.get(c)?.get(m) ?? 0;
      budgeted += l;
      spentB += s;
      if (s <= l) ok++;
      else over += s - l;
    }
    const asOfEnd = ends[i]!;
    const views = gs.filter((g) => g.start_date <= asOfEnd).map((g) => goalView(g, cs, asOfEnd));
    const dated = views.filter((v) => v.targetDate);
    const input: HealthInput = {
      income,
      expenses,
      months: window.length,
      debtPayments: window.reduce((s, x) => s + (debtMap.get(x) ?? 0), 0),
      liquid: hasLiquid ? (liqMap.get(asOfEnd) ?? 0) : null,
      budget: { ok, total, overMinor: over, budgetedMinor: budgeted, spentMinor: spentB },
      goals: {
        onTrack: dated.filter((v) => v.status === 'on_track' || v.status === 'completed').length,
        dated: dated.length,
        extraMonthlyMinor: dated.filter((v) => v.status === 'behind').reduce((s, v) => s + Math.max(0, (v.requiredMonthlyMinor ?? 0) - v.paceMinor), 0),
      },
    };
    return { month: m, input, result: computeHealth(input), goals: views };
  });
  const current = out[out.length - 1]!;
  const prev = out[out.length - 2];
  const goalViews = gs.map((g) => goalView(g, cs, base.today));
  const surplus = mean(lastCompleteMonths(base.complete, 3).map((m) => (p.get(m)?.income ?? 0) - (p.get(m)?.expenses ?? 0)));
  return {
    months: out,
    current,
    change: current.result.overall !== null && prev?.result.overall !== null && prev?.result.overall !== undefined ? current.result.overall - prev.result.overall : null,
    recommendations: recommendations(current.input),
    goals: goalViews,
    goalsSummary: goalsSummary(goalViews, surplus),
    pnl: p,
  };
}
