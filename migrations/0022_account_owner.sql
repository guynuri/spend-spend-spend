-- Whose account it is (D-R28), for "who paid": a household member's user id, or NULL = shared.
-- Not a foreign key (users is global); a value for someone no longer a member reads as shared.
ALTER TABLE accounts ADD COLUMN owner_user_id TEXT;
