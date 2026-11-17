-- Investment / trading accounts. The API exposes type 'investment'; the row keeps type 'savings' and
-- sets is_investment = 1, because widening the CHECK on accounts.type needs a table rebuild, and on D1
-- dropping the old table cascades to every child table (foreign keys cannot be switched off). See DECISIONS.md.
ALTER TABLE accounts ADD COLUMN is_investment INTEGER NOT NULL DEFAULT 0 CHECK (is_investment IN (0, 1));
