import { SQL_RULE_ORDER } from '../../../shared/domain/ledger';
import type { TenantDb } from '../tenant';

const fieldMatch = (col: string) => `(
  (r.match = 'equals' AND ${col} = r.pattern_norm) OR
  (r.match = 'contains' AND instr(${col}, r.pattern_norm) > 0) OR
  (r.match = 'starts_with' AND substr(${col}, 1, length(r.pattern_norm)) = r.pattern_norm))`;

/** Correlated subquery selecting the winning rule's `select` column (PLAN §9.6). */
export function winningRuleSql(o: { hh: string; amount: string; dn: string; op: string; select: 'r.id' | 'r.category_id' }) {
  return `(SELECT ${o.select} FROM category_rules r
   WHERE r.household_id = ${o.hh}
     AND (r.sign = 'any' OR (r.sign = 'in' AND ${o.amount} > 0) OR (r.sign = 'out' AND ${o.amount} < 0))
     AND ((r.field = 'description' AND ${o.dn} <> '' AND ${fieldMatch(o.dn)})
       OR (r.field = 'operation_type' AND ${o.op} IS NOT NULL AND ${o.op} <> '' AND ${fieldMatch(o.op)}))
   ORDER BY ${SQL_RULE_ORDER} LIMIT 1)`;
}
export const WINNING_RULE = winningRuleSql({ hh: 't.household_id', amount: 't.amount_minor', dn: 't.description_norm', op: 't.operation_type', select: 'r.id' });

export type RuleScope = { kind: 'all' } | { kind: 'import'; importId: string } | { kind: 'ids'; ids: string[] };

/** Applies rules to uncategorized, unsplit transactions in scope. Never touches user choices. */
export async function applyRulesStmt(q: TenantDb, scope: RuleScope, now: string) {
  const scopeSql = scope.kind === 'import' ? 'AND t.import_id = ?3' : scope.kind === 'ids' ? 'AND t.id IN (SELECT value FROM json_each(?3))' : '';
  const params: (string | null)[] = [now];
  if (scope.kind === 'import') params.push(scope.importId);
  if (scope.kind === 'ids') params.push(JSON.stringify(scope.ids));
  return q.stmt(
    `WITH m AS (
       SELECT t.id AS tx_id, ${WINNING_RULE} AS rule_id FROM transactions t
        WHERE t.household_id = ?1 AND t.category_id IS NULL AND t.has_splits = 0 ${scopeSql}
     )
     UPDATE transactions SET category_id = cr.category_id, category_source = 'rule', updated_at = ?2
       FROM m JOIN category_rules cr ON cr.id = m.rule_id AND cr.household_id = ?1
      WHERE transactions.id = m.tx_id AND transactions.household_id = ?1`,
    ...params,
  );
}
