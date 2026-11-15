import { HttpError } from '../http';
import { newId, nowIso } from '../lib/crypto';
import { isTenantTable } from './tables';
import { householdMembers } from './members';

type Param = string | number | null | ArrayBuffer;
const SCOPED = /household_id\s*=\s*\?1\b/;
const IDENT = /^[a-z_][a-z0-9_]*$/;

export class UnscopedSqlError extends Error {}

/**
 * The only way to touch tenant data (PLAN §6.2). `?1` is always the household id; the SQL text
 * must contain `household_id = ?1` or the call throws. Route params start at `?2`.
 */
export function tenantDb(db: D1Database, householdId: string) {
  if (!householdId) throw new Error('tenantDb requires a household id');
  const prep = (sql: string, params: Param[]) => {
    if (!SCOPED.test(sql)) throw new UnscopedSqlError(`tenant SQL must contain "household_id = ?1": ${sql.slice(0, 60)}`);
    return db.prepare(sql).bind(householdId, ...params);
  };

  const insertStmt = (table: string, row: Record<string, Param | boolean | undefined>) => {
    if (!isTenantTable(table)) throw new Error(`not a tenant table: ${table}`);
    if ('household_id' in row) throw new Error('row must not carry household_id');
    const cols = Object.keys(row).filter((k) => row[k] !== undefined);
    for (const c of cols) if (!IDENT.test(c)) throw new Error(`bad column ${c}`);
    const vals = cols.map((c) => {
      const v = row[c];
      return typeof v === 'boolean' ? (v ? 1 : 0) : (v as Param);
    });
    const sql = `INSERT INTO ${table} (household_id, ${cols.join(', ')}) VALUES (?1, ${cols.map((_, i) => `?${i + 2}`).join(', ')})`;
    return db.prepare(sql).bind(householdId, ...vals);
  };

  /**
   * One set-based INSERT for many rows: INSERT … SELECT ?1, json_extract(value, '$.col') … FROM json_each(?2).
   * Keeps D1 queries per request low (PLAN §4.2). Caller chunks to ≤ 500 rows.
   */
  const bulkInsertStmt = (table: string, cols: string[], rows: Record<string, Param | boolean | undefined>[]) => {
    if (!isTenantTable(table)) throw new Error(`not a tenant table: ${table}`);
    for (const c of cols) if (!IDENT.test(c) || c === 'household_id') throw new Error(`bad column ${c}`);
    const data = rows.map((r) => cols.map((c) => (typeof r[c] === 'boolean' ? (r[c] ? 1 : 0) : (r[c] ?? null))));
    const sql = `INSERT INTO ${table} (household_id, ${cols.join(', ')}) SELECT ?1, ${cols.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ')} FROM json_each(?2)`;
    return db.prepare(sql).bind(householdId, JSON.stringify(data));
  };

  const q = {
    householdId,
    bulkInsertStmt,
    bulkInsertStmts: (table: string, cols: string[], rows: Record<string, Param | boolean | undefined>[], chunk = 400) => {
      const out: D1PreparedStatement[] = [];
      for (let i = 0; i < rows.length; i += chunk) out.push(bulkInsertStmt(table, cols, rows.slice(i, i + chunk)));
      return out;
    },
    /** Global AI calls today across all households — a counter only, used for the global daily cap (AC13.3). */
    aiCallsToday: async (day: string) => (await db.prepare('SELECT COALESCE(SUM(calls), 0) AS n FROM ai_usage WHERE day = ?1').bind(day).first<{ n: number }>())?.n ?? 0,
    /** Membership/invite operations for THIS household only. */
    members: householdMembers(db, householdId),
    all: async <T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T[]> => (await prep(sql, params).all<T>()).results,
    first: <T = Record<string, unknown>>(sql: string, ...params: Param[]): Promise<T | null> => prep(sql, params).first<T>(),
    run: (sql: string, ...params: Param[]) => prep(sql, params).run(),
    /** A prepared, scoped statement for use in batch(). */
    stmt: (sql: string, ...params: Param[]) => prep(sql, params),
    batch: (stmts: D1PreparedStatement[]) => db.batch(stmts),
    insertStmt,
    insert: async (table: string, row: Record<string, Param | boolean | undefined>) => {
      await insertStmt(table, row).run();
    },
    /** True when `id` exists in `table` for this household. */
    owns: async (table: string, id: string | null | undefined): Promise<boolean> => {
      if (!id) return false;
      if (!isTenantTable(table)) throw new Error(`not a tenant table: ${table}`);
      return !!(await prep(`SELECT 1 AS x FROM ${table} WHERE household_id = ?1 AND id = ?2`, [id]).first());
    },
    /** Every foreign id from a payload must belong to this household; otherwise 404. */
    assertOwned: async (spec: Partial<Record<string, (string | null | undefined)[]>>) => {
      const stmts: D1PreparedStatement[] = [];
      const expected: number[] = [];
      for (const [table, ids] of Object.entries(spec)) {
        if (!isTenantTable(table)) throw new Error(`not a tenant table: ${table}`);
        const uniq = [...new Set((ids ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0))];
        if (!uniq.length) continue;
        stmts.push(prep(`SELECT COUNT(*) AS n FROM ${table} WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2))`, [JSON.stringify(uniq)]));
        expected.push(uniq.length);
      }
      if (!stmts.length) return;
      const res = await db.batch<{ n: number }>(stmts);
      res.forEach((r, i) => {
        if ((r.results[0]?.n ?? 0) !== expected[i]) throw new HttpError(404, 'not_found', 'Not found');
      });
    },
    audit: (userId: string | null, action: string, entity?: string, entityId?: string, meta?: Record<string, unknown>) =>
      insertStmt('audit_log', { id: newId(), user_id: userId, action, entity: entity ?? null, entity_id: entityId ?? null, meta_json: meta ? JSON.stringify(meta) : null, created_at: nowIso() }),
  };
  return q;
}

export type TenantDb = ReturnType<typeof tenantDb>;
