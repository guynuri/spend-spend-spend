-- Pay-day periods (D-R23): budget "months" start on this day (1 = calendar months).
-- stats_by_period: 1 = statistics (Trends) follow the same periods, 0 = calendar months.
ALTER TABLE households ADD COLUMN period_start_day INTEGER NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28);
ALTER TABLE households ADD COLUMN stats_by_period INTEGER NOT NULL DEFAULT 1 CHECK (stats_by_period IN (0, 1));
