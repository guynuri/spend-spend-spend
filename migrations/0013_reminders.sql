-- Per-user reminders (tenant table: household + user) and Web Push subscriptions (global, per user/device).
-- kind import: freq weekly (day = weekday 0=Sun) or monthly (day = 1..31, clamped to the month length).
-- kind daily: weekdays bitmask (bit 0 = Sunday). kind review: fires once per month that becomes reviewable.
-- Times are local to the household timezone, on the hour.
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('import', 'daily', 'review')),
  freq TEXT CHECK (freq IN ('weekly', 'monthly')),
  day INTEGER,
  weekdays INTEGER NOT NULL DEFAULT 127,
  hour INTEGER NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
  account_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- push: the last time the cron fired it; in-app: when the user last saw / dismissed it
  last_sent_at TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  -- review kind: last month notified, last availability check
  review_month TEXT,
  -- 1 after a failed send was released for one retry on the next tick
  retry INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reminders_user ON reminders(household_id, user_id);
CREATE INDEX reminders_enabled ON reminders(enabled, last_sent_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
