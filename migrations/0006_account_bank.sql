-- Optional catalog bank of an account (src/shared/banks.ts); free-text banks stay in institution.
ALTER TABLE accounts ADD COLUMN bank_id TEXT;
