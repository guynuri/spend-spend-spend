import type { Locale } from '../../shared/money';
import type { TenantDb } from '../db/tenant';
import { newId, nowIso } from '../lib/crypto';
import { DEMO_TABLE_ORDER, buildDemo, categoryKeyMap, type DemoData } from './demo';

/** Statements inserting demo data with set-based inserts (one per table chunk). */
export function demoInsertStatements(q: TenantDb, data: DemoData) {
  const stmts: D1PreparedStatement[] = [];
  for (const t of DEMO_TABLE_ORDER) {
    const rows = data[t];
    if (!rows.length) continue;
    stmts.push(...q.bulkInsertStmts(t, Object.keys(rows[0]!), rows));
  }
  return stmts;
}

export async function buildDemoFor(q: TenantDb, today: string, locale: Locale) {
  const cats = await q.all<{ id: string; name: string; system_key: string | null }>('SELECT id, name, system_key FROM categories WHERE household_id = ?1');
  return buildDemo(today, locale, categoryKeyMap(cats), newId, nowIso());
}
