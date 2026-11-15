import type { Locale } from '../../shared/money';
import { defaultCategoryRows } from '../seed/defaults';
import { tenantDb } from './tenant';

/** Two set-based statements that seed a new household (default categories + seed rules). */
export function householdInitStatements(db: D1Database, householdId: string, locale: Locale) {
  const q = tenantDb(db, householdId);
  const { categories, rules } = defaultCategoryRows(locale);
  return [...q.bulkInsertStmts('categories', Object.keys(categories[0]!), categories), ...q.bulkInsertStmts('category_rules', Object.keys(rules[0]!), rules)];
}
