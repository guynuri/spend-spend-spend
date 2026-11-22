import { recapWeek, type WeekRecap } from '../../../shared/domain/alerts';
import type { TenantDb } from '../tenant';
import { computeBudget } from './budget';
import type { BaseFacts } from './facts';

const EXPENSE_LINE = "(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0))";

/** The weekly recap for the week before `today` (D-R27): spending, the week before, top categories, what's left. */
export async function weekRecapFor(q: TenantDb, base: BaseFacts, today = base.today): Promise<WeekRecap> {
  const w = recapWeek(today);
  const [sum, top] = await q.batch([
    q.stmt(
      `SELECT COALESCE(-SUM(CASE WHEN l.date >= ?2 THEN l.amount_minor END), 0) AS cur, COALESCE(-SUM(CASE WHEN l.date < ?2 THEN l.amount_minor END), 0) AS prev
         FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?3 AND l.date <= ?4`,
      w.from,
      w.prevFrom,
      w.to,
    ),
    q.stmt(
      `SELECT l.category_id AS cid, -SUM(l.amount_minor) AS spent FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?2 AND l.date <= ?3 GROUP BY l.category_id HAVING spent > 0 ORDER BY spent DESC LIMIT 3`,
      w.from,
      w.to,
    ),
  ]);
  const s = sum!.results[0] as { cur: number; prev: number };
  const b = base.hasData ? await computeBudget(q, base, base.cal.of(today), 1) : null;
  const t = b?.totals;
  return {
    from: w.from,
    to: w.to,
    spentMinor: s.cur,
    prevSpentMinor: s.prev,
    top: (top!.results as { cid: string | null; spent: number }[]).map((r) => ({ categoryId: r.cid, spentMinor: r.spent })),
    leftMinor: t && t.budgetedMinor > 0 ? t.budgetedMinor - t.spentBudgetedMinor : null,
  };
}
