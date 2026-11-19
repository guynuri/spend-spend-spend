/**
 * Every tenant table, in delete order (children first). Drives household reset/delete and the
 * isolation suite; a test asserts every table with a household_id column is listed here.
 */
export const TENANT_TABLES = [
  'reminders',
  'ai_usage',
  'reviews',
  'goal_contributions',
  'goals',
  'budgets',
  'general_budgets',
  'yearly_budgets',
  'transaction_splits',
  'transactions',
  'planned_expenses',
  'recurring_overrides',
  'recurring_items',
  'account_balances',
  'import_profiles',
  'import_rows',
  'imports',
  'category_rules',
  'categories',
  'accounts',
  'audit_log',
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];
export const isTenantTable = (t: string): t is TenantTable => (TENANT_TABLES as readonly string[]).includes(t);

/** Tables kept on "reset data" (audit history survives a reset; it goes with the household). */
export const KEEP_ON_RESET: readonly TenantTable[] = ['audit_log'];
