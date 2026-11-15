import { addDays, monthOf } from '../../shared/dates';
import type { TenantDb } from './tenant';
import type { HouseholdRow } from './rows';
import { loadBase } from './sql/facts';
import { computeBudget } from './sql/budget';

/** Nav badges: uncategorized count (last 60 days) and an over-budget dot for the current month. */
export async function loadBadges(q: TenantDb, hh: HouseholdRow, today: string) {
  const r = await q.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions t WHERE t.household_id = ?1 AND t.category_id IS NULL AND t.has_splits = 0 AND t.date >= ?2`,
    addDays(today, -60),
  );
  const base = await loadBase(q, hh);
  const b = base.hasData ? await computeBudget(q, base, monthOf(today), 1) : null;
  return { uncategorized: r?.n ?? 0, overBudget: (b?.totals.counts.over ?? 0) > 0 };
}
