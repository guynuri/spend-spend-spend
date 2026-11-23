-- Two more reminder kinds (D-R27): 'budget' (a nudge when a budget reaches 80 % and 100 %) and 'recap'
-- (a short weekly recap; day = weekday 0=Sun, hour local). SQLite can't change a CHECK, so the table is
-- rebuilt; nothing references it. `marks` (JSON) remembers the budget thresholds already announced this
-- period: {"month":"YYYY-MM","keys":["<categoryId>:80", ...]}.
CREATE TABLE reminders_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('import', 'daily', 'review', 'budget', 'recap')),
  freq TEXT CHECK (freq IN ('weekly', 'monthly')),
  day INTEGER,
  weekdays INTEGER NOT NULL DEFAULT 127,
  hour INTEGER NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
  account_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_sent_at TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  review_month TEXT,
  retry INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT,
  created_at TEXT NOT NULL,
  marks TEXT
);
INSERT INTO reminders_new (id, household_id, user_id, kind, freq, day, weekdays, hour, account_id, enabled, last_sent_at, seen_at, review_month, retry, checked_at, created_at)
  SELECT id, household_id, user_id, kind, freq, day, weekdays, hour, account_id, enabled, last_sent_at, seen_at, review_month, retry, checked_at, created_at FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_new RENAME TO reminders;
CREATE INDEX reminders_user ON reminders(household_id, user_id);
CREATE INDEX reminders_enabled ON reminders(enabled, last_sent_at);
