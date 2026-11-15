import { addDays } from '../../../shared/dates';
import { linkTransactions, type LinkTx } from '../../../shared/domain/recurring';
import type { TenantDb } from '../tenant';
import { parseRecurring, recurringStmts } from './recurringData';

/**
 * Post-write passes (PLAN §10.2 / AC4.9, AC6.5): link unlinked transactions to recurring
 * occurrences, match planned expenses, mark card-paid planned items done once their charge settles.
 */
export async function afterTransactionsWritten(q: TenantDb, scope: { importId?: string; ids?: string[] }, today: string): Promise<void> {
  const since = addDays(today, -400);
  const scopeSql = scope.importId ? 'AND (t.import_id = ?2 OR t.merged_import_id = ?2)' : 'AND t.id IN (SELECT value FROM json_each(?2))';
  const scopeParam = scope.importId ?? JSON.stringify(scope.ids ?? []);
  const res = await q.batch([
    ...recurringStmts(q, since),
    q.stmt(`SELECT t.id, t.account_id, t.date, t.amount_minor, t.description_norm, t.kind FROM transactions t WHERE t.household_id = ?1 AND t.recurring_id IS NULL AND t.planned_id IS NULL ${scopeSql}`, scopeParam),
  ]);
  const { items, overrides, settled } = parseRecurring(res);
  const txs = res[3]!.results as unknown as LinkTx[];
  const links = linkTransactions(items, txs, overrides, settled);
  const stmts: D1PreparedStatement[] = [];
  if (links.length)
    stmts.push(
      q.stmt(
        `UPDATE transactions SET recurring_id = l.item, recurring_due = l.due
           FROM (SELECT json_extract(j.value, '$.txId') AS tx, json_extract(j.value, '$.itemId') AS item, json_extract(j.value, '$.due') AS due FROM json_each(?2) j) AS l
          WHERE transactions.household_id = ?1 AND transactions.id = l.tx
            AND EXISTS (SELECT 1 FROM recurring_items r WHERE r.household_id = ?1 AND r.id = l.item)`,
        JSON.stringify(links),
      ),
    );
  const linked = new Set(links.map((l) => l.txId));
  const free = txs.filter((t) => !linked.has(t.id)).map((t) => t.id);
  // Planned expenses paid from an account: same account, same sign, amount within 10 %, ±7 days, nearest first.
  if (free.length)
    stmts.push(
      q.stmt(
        `WITH c AS (
           SELECT p.id AS pid, t.id AS tid, ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY abs(julianday(t.date) - julianday(p.date)), t.id) AS r1,
                  ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY abs(julianday(t.date) - julianday(p.date)), p.id) AS r2
             FROM planned_expenses p JOIN transactions t ON t.household_id = ?1 AND t.id IN (SELECT value FROM json_each(?2))
            WHERE p.household_id = ?1 AND p.status = 'planned' AND p.card_recurring_id IS NULL
              AND (p.account_id IS NULL OR p.account_id = t.account_id) AND (p.amount_minor < 0) = (t.amount_minor < 0)
              AND abs(abs(t.amount_minor) - abs(p.amount_minor)) <= abs(p.amount_minor) * 0.1 AND abs(julianday(t.date) - julianday(p.date)) <= 7)
         UPDATE planned_expenses SET status = 'done', matched_tx_id = c.tid FROM c WHERE planned_expenses.household_id = ?1 AND planned_expenses.id = c.pid AND c.r1 = 1 AND c.r2 = 1`,
        JSON.stringify(free),
      ),
      q.stmt(
        `UPDATE transactions SET planned_id = p.id FROM planned_expenses p
          WHERE transactions.household_id = ?1 AND p.household_id = ?1 AND p.matched_tx_id = transactions.id AND transactions.planned_id IS NULL`,
      ),
    );
  // Card-paid planned items are done once the first charge after their date has settled.
  stmts.push(
    q.stmt(
      `UPDATE planned_expenses SET status = 'done' WHERE household_id = ?1 AND status = 'planned' AND card_recurring_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = ?1 AND t.recurring_id = planned_expenses.card_recurring_id AND t.recurring_due > planned_expenses.date)`,
    ),
  );
  await q.batch(stmts);
}
