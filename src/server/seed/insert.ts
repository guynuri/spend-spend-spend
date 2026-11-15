import type { Locale } from '../../shared/money';
import type { TenantDb } from '../db/tenant';
import { newId, nowIso } from '../lib/crypto';
import { DEFAULT_CATEGORIES, categoryRow } from './defaults';
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

/** Default keys the sample data references (recorded from a dry run, so it never drifts from buildDemo). */
function demoKeys(today: string, locale: Locale) {
  const used = new Set<string>();
  const rec = { get: (k: string) => (used.add(k), k) } as unknown as Map<string, string>;
  buildDemo(today, locale, rec, newId, nowIso());
  return used;
}

/** The sample data uses some catalog extras (car, travel…): add the missing ones first. */
export async function buildDemoFor(q: TenantDb, today: string, locale: Locale) {
  const load = () => q.all<{ id: string; name: string; system_key: string | null }>('SELECT id, name, system_key FROM categories WHERE household_id = ?1');
  let cats = await load();
  const have = categoryKeyMap(cats);
  const keys = demoKeys(today, locale);
  const missing = DEFAULT_CATEGORIES.filter((d) => keys.has(d.key) && !have.has(d.key)).map((d, i) => categoryRow(d, locale, 100 + i));
  if (missing.length) {
    await q.batch(q.bulkInsertStmts('categories', Object.keys(missing[0]!), missing));
    cats = await load();
  }
  return buildDemo(today, locale, categoryKeyMap(cats), newId, nowIso());
}
