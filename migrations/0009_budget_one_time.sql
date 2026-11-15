-- One-time (single-month) budgets. A row with one_time = 1 applies only to its effective_from month
-- and wins over the recurring limit for that month; recurring rows (one_time = 0) carry forward as before.
-- SQLite cannot alter a UNIQUE constraint, so the table is rebuilt (nothing references budgets).
CREATE TABLE budgets_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  limit_minor INTEGER,
  one_time INTEGER NOT NULL DEFAULT 0 CHECK (one_time IN (0, 1)),
  UNIQUE (household_id, category_id, effective_from, one_time)
);
INSERT INTO budgets_new (id, household_id, category_id, effective_from, limit_minor) SELECT id, household_id, category_id, effective_from, limit_minor FROM budgets;
DROP TABLE budgets;
ALTER TABLE budgets_new RENAME TO budgets;
