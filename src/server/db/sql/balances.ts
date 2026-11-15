import type { TenantDb } from '../tenant';

export interface AccountBalanceRow {
  account_id: string;
  snap_date: string | null;
  balance: number;
}

/**
 * Balance of every account at date D (PLAN §10.1): latest snapshot ≤ D plus later
 * transactions ≤ D; with no snapshot, opening balance + transactions from the opening date.
 */
export function balancesAt(q: TenantDb, date: string) {
  return q.all<AccountBalanceRow>(
    `WITH s AS (
       SELECT a.id AS account_id, a.opening_balance_minor AS ob, a.opening_date AS od,
              (SELECT b.date FROM account_balances b WHERE b.household_id = ?1 AND b.account_id = a.id AND b.date <= ?2 ORDER BY b.date DESC LIMIT 1) AS sd
         FROM accounts a WHERE a.household_id = ?1)
     SELECT s.account_id, s.sd AS snap_date,
            CASE WHEN s.sd IS NOT NULL THEN
              (SELECT b.balance_minor FROM account_balances b WHERE b.household_id = ?1 AND b.account_id = s.account_id AND b.date = s.sd)
              + COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.household_id = ?1 AND t.account_id = s.account_id AND t.date > s.sd AND t.date <= ?2), 0)
            ELSE
              s.ob + COALESCE((SELECT SUM(t.amount_minor) FROM transactions t WHERE t.household_id = ?1 AND t.account_id = s.account_id AND (s.od IS NULL OR t.date >= s.od) AND t.date <= ?2), 0)
            END AS balance
       FROM s`,
    date,
  );
}

/** Latest snapshot and variance vs opening + Σ transactions (only when an opening date exists). */
export function snapshotsAndVariance(q: TenantDb) {
  return q.all<{ account_id: string; date: string | null; balance_minor: number | null; source: string | null; variance: number | null }>(
    `SELECT a.id AS account_id, b.date, b.balance_minor, b.source,
            CASE WHEN a.opening_date IS NOT NULL AND b.date IS NOT NULL THEN
              b.balance_minor - (a.opening_balance_minor + COALESCE((SELECT SUM(t.amount_minor) FROM transactions t
                 WHERE t.household_id = ?1 AND t.account_id = a.id AND t.date >= a.opening_date AND t.date <= b.date), 0))
            END AS variance
       FROM accounts a
       LEFT JOIN account_balances b ON b.household_id = ?1 AND b.account_id = a.id
            AND b.date = (SELECT MAX(b2.date) FROM account_balances b2 WHERE b2.household_id = ?1 AND b2.account_id = a.id)
      WHERE a.household_id = ?1`,
  );
}
