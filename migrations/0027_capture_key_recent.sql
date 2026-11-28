-- Live card tracking diagnostics (D-R35): a key's last 5 attempts (newest first), so a hand-run test
-- never hides the failed purchase before it. JSON array of { at, result, detail } — never values.
ALTER TABLE capture_keys ADD COLUMN recent_json TEXT;
-- keys already used keep their last result as the first entry of their history
UPDATE capture_keys SET recent_json = json_array(json_object('at', last_used_at, 'result', last_result, 'detail', last_detail))
 WHERE last_result IS NOT NULL AND last_used_at IS NOT NULL;
