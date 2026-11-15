import type { Override, RecItem, Settled } from '../../../shared/domain/recurring';
import type { TenantDb } from '../tenant';

export function recurringStmts(q: TenantDb, settledSince: string) {
  return [
    q.stmt('SELECT * FROM recurring_items WHERE household_id = ?1 ORDER BY created_at, id'),
    q.stmt('SELECT recurring_id, due_date, amount_minor, skipped FROM recurring_overrides WHERE household_id = ?1'),
    q.stmt(
      `SELECT recurring_id, recurring_due AS due, amount_minor, id AS tx_id FROM transactions
        WHERE household_id = ?1 AND recurring_id IS NOT NULL AND recurring_due IS NOT NULL AND recurring_due >= ?2`,
      settledSince,
    ),
  ];
}
export function parseRecurring(res: D1Result[]) {
  return {
    items: res[0]!.results as unknown as RecItem[],
    overrides: res[1]!.results as unknown as Override[],
    settled: res[2]!.results as unknown as Settled[],
  };
}
