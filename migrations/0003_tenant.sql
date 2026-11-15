-- Tenant tables (PLAN §5.2). Every table has household_id as the first column of its main index.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'cash', 'credit_card')),
  institution TEXT,
  account_mask TEXT,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT,
  include_in_forecast INTEGER NOT NULL DEFAULT 1,
  is_liquid INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX accounts_h ON accounts(household_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  grp TEXT CHECK (grp IN ('fixed', 'variable')),
  is_debt INTEGER NOT NULL DEFAULT 0,
  system_key TEXT,
  icon TEXT,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE (household_id, name)
);

CREATE TABLE category_rules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  field TEXT NOT NULL CHECK (field IN ('description', 'operation_type')),
  match TEXT NOT NULL CHECK (match IN ('contains', 'equals', 'starts_with')),
  pattern_norm TEXT NOT NULL,
  sign TEXT NOT NULL DEFAULT 'any' CHECK (sign IN ('any', 'in', 'out')),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('user', 'learned', 'ai', 'seed')),
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, field, match, pattern_norm, sign)
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  parser_id TEXT NOT NULL,
  file_name TEXT,
  file_hash TEXT,
  period_start TEXT,
  period_end TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_merged INTEGER NOT NULL DEFAULT 0,
  rows_error INTEGER NOT NULL DEFAULT 0,
  closing_balance_minor INTEGER,
  closing_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed', 'undone')),
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX imports_h ON imports(household_id, created_at);

-- Staging rows of an open import (uploaded in ≤ 250-row chunks, consumed by commit).
CREATE TABLE import_rows (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  chunk INTEGER NOT NULL,
  rows_json TEXT NOT NULL,
  PRIMARY KEY (household_id, import_id, chunk)
);

CREATE TABLE import_profiles (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  header_signature TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, header_signature)
);
CREATE INDEX import_profiles_h ON import_profiles(household_id, account_id);

CREATE TABLE account_balances (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance_minor INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('import', 'manual')),
  import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  UNIQUE (account_id, date)
);
CREATE INDEX account_balances_h ON account_balances(household_id, account_id, date);

CREATE TABLE recurring_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'card_charge')),
  amount_minor INTEGER NOT NULL,
  amount_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (amount_mode IN ('fixed', 'estimated')),
  cadence TEXT NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('weekly', 'monthly', 'bimonthly', 'quarterly', 'yearly')),
  day_of_month INTEGER,
  anchor_date TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  match_norm TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'suggested', 'dismissed')),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'detected', 'seed')),
  created_at TEXT NOT NULL
);
CREATE INDEX recurring_h ON recurring_items(household_id, status);

CREATE TABLE recurring_overrides (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recurring_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  amount_minor INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  UNIQUE (recurring_id, due_date)
);
CREATE INDEX recurring_overrides_h ON recurring_overrides(household_id, recurring_id);

CREATE TABLE planned_expenses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  date TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  card_recurring_id TEXT REFERENCES recurring_items(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  matched_tx_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX planned_h ON planned_expenses(household_id, date);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value_date TEXT,
  amount_minor INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  description_norm TEXT NOT NULL DEFAULT '',
  reference TEXT,
  operation_type TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  category_source TEXT CHECK (category_source IN ('user', 'rule', 'ai')),
  has_splits INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'card_lump')),
  notes TEXT,
  recurring_id TEXT REFERENCES recurring_items(id) ON DELETE SET NULL,
  recurring_due TEXT,
  planned_id TEXT REFERENCES planned_expenses(id) ON DELETE SET NULL,
  import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  merged_import_id TEXT,
  dedupe_key TEXT NOT NULL,
  balance_after_minor INTEGER,
  source TEXT NOT NULL CHECK (source IN ('import', 'manual')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, account_id, dedupe_key)
);
CREATE INDEX tx_h_date ON transactions(household_id, date);
CREATE INDEX tx_h_cat_date ON transactions(household_id, category_id, date);
CREATE INDEX tx_h_import ON transactions(household_id, import_id);
CREATE INDEX tx_h_rec ON transactions(household_id, recurring_id, recurring_due);
CREATE INDEX tx_h_acct_date ON transactions(household_id, account_id, date);

CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX splits_h_tx ON transaction_splits(household_id, transaction_id);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  limit_minor INTEGER,
  UNIQUE (household_id, category_id, effective_from)
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_minor INTEGER NOT NULL,
  start_minor INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  target_date TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at TEXT NOT NULL
);
CREATE INDEX goals_h ON goals(household_id);

CREATE TABLE goal_contributions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  note TEXT,
  transaction_id TEXT
);
CREATE INDEX goal_contrib_h ON goal_contributions(household_id, goal_id, date);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  snapshot_json TEXT,
  ai_json TEXT,
  health_score INTEGER,
  completed_at TEXT,
  completed_by TEXT,
  UNIQUE (household_id, month)
);

CREATE TABLE ai_usage (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  feature TEXT NOT NULL CHECK (feature IN ('categorize', 'review')),
  calls INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, day, feature)
);
CREATE INDEX ai_usage_day ON ai_usage(day);

-- Effective lines: the unit for all category math (PLAN §5.2).
CREATE VIEW v_lines AS
SELECT t.household_id, t.id AS tx_id, NULL AS split_id, t.account_id, t.date, t.amount_minor,
       t.category_id, t.kind, t.recurring_id, t.planned_id
  FROM transactions t WHERE t.has_splits = 0
UNION ALL
SELECT t.household_id, t.id, s.id, t.account_id, t.date, s.amount_minor,
       s.category_id, t.kind, t.recurring_id, t.planned_id
  FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id AND t.household_id = s.household_id;
