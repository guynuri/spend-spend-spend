-- Card accounts (D-R20).
-- A bank card charge (kind 'card_lump') linked to the credit-card account it pays: the account id, or
-- 'none' when the user unlinked it (never re-linked automatically). Linked charges are booked by split
-- lines the app maintains: the bill payment (a transfer) and the part not itemized yet (still spending).
ALTER TABLE transactions ADD COLUMN card_account_id TEXT;
-- Entries added by a phone automation (Apple Pay); they are manual rows, so a card file merges them.
ALTER TABLE transactions ADD COLUMN captured INTEGER NOT NULL DEFAULT 0 CHECK (captured IN (0, 1));
CREATE INDEX tx_card_link ON transactions(household_id, card_account_id);

-- Per-user keys for the phone automations (add-only): stored as SHA-256, shown once.
CREATE TABLE capture_keys (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX capture_keys_h ON capture_keys(household_id, user_id);
