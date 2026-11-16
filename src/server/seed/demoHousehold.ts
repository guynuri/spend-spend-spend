import type { Locale } from '../../shared/money';
import { todayInTz } from '../../shared/dates';
import { globalDb } from '../db/global';
import type { HouseholdRow } from '../db/rows';
import { tenantDb } from '../db/tenant';
import { TENANT_TABLES } from '../db/tables';
import { newId, nowIso } from '../lib/crypto';
import { DEFAULT_CATEGORIES, categoryRow } from './defaults';
import { buildDemo, categoryKeyMap } from './demo';
import { demoInsertStatements } from './insert';

/**
 * The app tour's read-only demo households (one per locale). They have no members, so the only way
 * in is a GET with `X-MZ-Demo` (see the household middleware), and they never hold real data: every
 * row comes from buildDemo. `~` is outside the newId alphabet, so no real household can collide.
 */
export const DEMO_HOUSEHOLD = { he: '~demo-he', en: '~demo-en' } as const;
export const isDemoHousehold = (id: string) => id === DEMO_HOUSEHOLD.he || id === DEMO_HOUSEHOLD.en;
const TZ = 'Asia/Jerusalem';

/**
 * (Re)builds the locale's demo household when it was not built today, so dates are always relative to
 * today. One atomic batch replaces every row; concurrent rebuilds just serialize and end identical.
 */
export async function ensureDemoHousehold(raw: D1Database, locale: Locale): Promise<HouseholdRow> {
  const id = DEMO_HOUSEHOLD[locale];
  const g = globalDb(raw);
  const cur = await g.getHousehold(id);
  const today = todayInTz(TZ);
  if (cur && todayInTz(TZ, new Date(cur.created_at)) === today) return cur;
  const q = tenantDb(raw, id);
  const now = nowIso();
  // Every catalog category (extras included) so the demo's car/travel rows resolve without a dry run.
  const cats = DEFAULT_CATEGORIES.map((d, i) => categoryRow(d, locale, i));
  const data = buildDemo(today, locale, categoryKeyMap(cats), newId, now);
  data.accounts[0]!.bank_id = 'otsar'; // shows "open bank website" in the tour
  await raw.batch([
    raw
      .prepare(`INSERT INTO households (id, name, locale, timezone, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at, status = 'active'`)
      .bind(id, locale === 'he' ? 'משפחת דוגמה' : 'Demo family', locale, TZ, now),
    ...TENANT_TABLES.map((t) => q.stmt(`DELETE FROM ${t} WHERE household_id = ?1`)),
    ...q.bulkInsertStmts('categories', Object.keys(cats[0]!), cats),
    ...demoInsertStatements(q, data),
  ]);
  return (await g.getHousehold(id))!;
}
