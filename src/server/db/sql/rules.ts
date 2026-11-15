import { SQL_RULE_ORDER } from '../../../shared/domain/ledger';
import type { TenantDb } from '../tenant';

const fieldMatch = (col: string) => `(
  (r.match = 'equals' AND ${col} = r.pattern_norm) OR
  (r.match = 'contains' AND instr(${col}, r.pattern_norm) > 0) OR
  (r.match = 'starts_with' AND substr(${col}, 1, length(r.pattern_norm)) = r.pattern_norm))`;

/** Correlated subquery: the winning rule id for transaction alias t (PLAN §9.6). */
export const WINNING_RULE = `(SELECT r.id FROM category_rules r
   WHERE r.household_id = t.household_id
     AND (r.sign = 'any' OR (r.sign = 'in' AND t.amount_minor > 0) OR (r.sign = 'out' AND t.amount_minor < 0))
     AND ((r.field = 'description' AND t.description_norm <> '' AND ${fieldMatch('t.description_norm')})
       OR (r.field = 'operation_type' AND t.operation_type IS NOT NULL AND t.operation_type <> '' AND ${fieldMatch('t.operation_type')}))
   ORDER BY ${SQL_RULE_ORDER} LIMIT 1)`;

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
