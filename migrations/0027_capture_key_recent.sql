-- Live card tracking diagnostics (D-R35): a key's last 5 attempts (newest first), so a hand-run test
-- never hides the failed purchase before it. JSON array of { at, result, detail } — never values.
ALTER TABLE capture_keys ADD COLUMN recent_json TEXT;
