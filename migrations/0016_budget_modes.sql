-- How a category is budgeted and reported:
--   monthly    (default) its own monthly budget line;
--   general    pooled with the other "general expenses" into one line with one shared monthly limit;
--   occasional irregular spending (vacations, gifts): budgeted per year, averaged over 12 months elsewhere.
ALTER TABLE categories ADD COLUMN budget_mode TEXT NOT NULL DEFAULT 'monthly' CHECK (budget_mode IN ('monthly', 'general', 'occasional'));

-- The shared monthly limit of the "general expenses" pool. Same rules as `budgets`: a recurring row
-- (one_time = 0) applies from effective_from on; a one-time row applies to exactly that month and wins.
CREATE TABLE general_budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,
  limit_minor INTEGER,
  one_time INTEGER NOT NULL DEFAULT 0 CHECK (one_time IN (0, 1)),
  UNIQUE (household_id, effective_from, one_time)
);

-- Yearly limits of occasional categories: applies to `year` and later years until replaced; NULL removes it.
CREATE TABLE yearly_budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  limit_minor INTEGER,
  UNIQUE (household_id, category_id, year)
);
