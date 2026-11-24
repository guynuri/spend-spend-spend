-- Live card tracking diagnostics (D-R32): what the last request with a key came to, so Settings can say
-- whether the phone reached the app and what it sent. `last_result` is a short code ('added', 'test',
-- 'unreadable_purchase', …); `last_detail` describes what arrived (type, length, field names — never values).
ALTER TABLE capture_keys ADD COLUMN last_result TEXT;
ALTER TABLE capture_keys ADD COLUMN last_detail TEXT;
