import { addDays } from '../../shared/dates';
import type { TenantDb } from './tenant';

/** Nav badges: uncategorized count (last 60 days); over-budget dot is added in M5. */
export async function loadBadges(q: TenantDb, today: string) {
  const r = await q.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions t WHERE t.household_id = ?1 AND t.category_id IS NULL AND t.has_splits = 0 AND t.date >= ?2`,
    addDays(today, -60),
  );
  return { uncategorized: r?.n ?? 0, overBudget: false };
}
