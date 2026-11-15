-- Lets a household dismiss the "monthly review is ready" prompt without completing the review.
ALTER TABLE reviews ADD COLUMN dismissed_at TEXT;
