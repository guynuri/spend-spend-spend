import type { Locale } from '../../shared/money';
import { defaultCategoryStatements } from '../seed/defaults';
import { tenantDb } from './tenant';

/** Statements that seed a brand-new household (default categories + seed rules). */
export function householdInitStatements(db: D1Database, householdId: string, locale: Locale) {
  const q = tenantDb(db, householdId);
  return defaultCategoryStatements((t, row) => q.insertStmt(t, row), locale).stmts;
}
