import { addDays, addMonths, monthOf } from '../../../shared/dates';
import { detectRecurring, groupKeyOf, type DetectRow } from '../../../shared/domain/recurring';
import type { TenantDb } from '../tenant';
import { newId, nowIso } from '../../lib/crypto';

/** Proposes `suggested` items from the last 6 months; patterns with any existing item are skipped (AC6.2). */
export async function runDetection(q: TenantDb, today: string): Promise<number> {
  const from = `${addMonths(monthOf(today), -6)}-01`;
  const [rows, existing] = await q.batch([
    q.stmt(
      `SELECT t.account_id, t.description_norm AS key, CASE WHEN t.amount_minor > 0 THEN 1 ELSE -1 END AS sign, (t.kind = 'card_lump') AS lump,
              t.date, t.amount_minor, t.category_id, t.description
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id AND c.household_id = ?1
        WHERE t.household_id = ?1 AND t.date >= ?2 AND t.date <= ?3 AND (c.kind IS NULL OR c.kind <> 'transfer') AND t.description_norm <> ''`,
      from,
      addDays(today, 0),
    ),
    q.stmt("SELECT account_id, match_norm, kind, amount_minor FROM recurring_items WHERE household_id = ?1"),
  ]);
  const data = (rows!.results as (Omit<DetectRow, 'lump'> & { lump: number; description: string })[]).map((r) => ({ ...r, lump: !!r.lump }));
  const names = new Map<string, string>();
  for (const r of data) names.set(groupKeyOf(r), r.description);
  const ex = existing!.results as { account_id: string | null; match_norm: string; kind: string; amount_minor: number }[];
  const have = new Set(ex.map((e) => (e.kind === 'card_charge' ? `${e.account_id}|card_lump|${e.match_norm}` : `${e.account_id}|${Math.sign(e.amount_minor)}|${e.match_norm}`)));
  const suggestions = detectRecurring(data, names).filter((s) =>
    s.kind === 'card_charge'
      ? !have.has(`${s.account_id}|card_lump|`) && !have.has(`${s.account_id}|card_lump|${s.match_norm}`)
      : !have.has(`${s.account_id}|${Math.sign(s.amount_minor)}|${s.match_norm}`),
  );
  if (!suggestions.length) return 0;
  const now = nowIso();
  await q.batch(
    q.bulkInsertStmts(
      'recurring_items',
      ['id', 'name', 'kind', 'amount_minor', 'amount_mode', 'cadence', 'day_of_month', 'anchor_date', 'account_id', 'category_id', 'match_norm', 'status', 'source', 'created_at'],
      suggestions.map((s) => ({ id: newId(), name: s.name.slice(0, 60), kind: s.kind, amount_minor: s.amount_minor, amount_mode: s.amount_mode, cadence: s.cadence, day_of_month: s.day_of_month, anchor_date: s.anchor_date, account_id: s.account_id, category_id: s.category_id, match_norm: s.match_norm, status: 'suggested', source: 'detected', created_at: now })),
    ),
  );
  return suggestions.length;
}

export async function afterImportCommitted(q: TenantDb, today: string): Promise<void> {
  await runDetection(q, today);
}
