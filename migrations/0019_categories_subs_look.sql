-- Subcategories, emoji and colour (D-R22).
-- A subcategory belongs to one top-level category of the same kind (one level only). All category math
-- reads v_lines, which now reports a subcategory's lines under its parent (category_id) and keeps the
-- category actually assigned in sub_category_id, so budgets, forecast, health and review roll up by
-- themselves and statistics can still break a parent down.
ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN emoji TEXT;
CREATE INDEX categories_parent ON categories(household_id, parent_id);

-- Default look for the catalog categories households already have (matched by any of their names).
-- `color` holds a palette slot (cat-1..cat-8, cat-other), never a raw colour.
UPDATE categories SET emoji = COALESCE(emoji, '💼'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-6' ELSE color END WHERE name IN ('Salary', 'משכורת') AND kind = 'income';
UPDATE categories SET emoji = COALESCE(emoji, '🤲'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-3' ELSE color END WHERE name IN ('Benefits & allowances', 'קצבאות והטבות') AND kind = 'income';
UPDATE categories SET emoji = COALESCE(emoji, '💰'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-1' ELSE color END WHERE name IN ('Other income', 'הכנסות אחרות') AND kind = 'income';
UPDATE categories SET emoji = COALESCE(emoji, '🏠'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-1' ELSE color END WHERE name IN ('Rent', 'שכר דירה') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🏦'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-7' ELSE color END WHERE name IN ('Mortgage', 'משכנתא') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🧾'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-8' ELSE color END WHERE name IN ('Loan repayments', 'החזרי הלוואות', 'Loans', 'הלוואות') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '💡'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-4' ELSE color END WHERE name IN ('Municipal tax & utilities', 'ארנונה וחשבונות') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '📱'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-3' ELSE color END WHERE name IN ('Phone & internet', 'טלפון ואינטרנט') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🛡️'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-7' ELSE color END WHERE name IN ('Insurance', 'ביטוחים') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🎓'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-2' ELSE color END WHERE name IN ('Education & childcare', 'חינוך ומסגרות') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🔁'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-5' ELSE color END WHERE name IN ('Subscriptions', 'מנויים') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🏛️'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-8' ELSE color END WHERE name IN ('Bank fees', 'עמלות בנק') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🛒'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-6' ELSE color END WHERE name IN ('Groceries', 'סופר ומכולת') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🍕'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-2' ELSE color END WHERE name IN ('Eating out', 'אוכל בחוץ') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '⛽'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-4' ELSE color END WHERE name IN ('Transport & fuel', 'תחבורה ודלק') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🚗'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-1' ELSE color END WHERE name IN ('Car', 'רכב') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🩺'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-8' ELSE color END WHERE name IN ('Health', 'בריאות') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '👕'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-5' ELSE color END WHERE name IN ('Clothing', 'ביגוד והנעלה') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🛋️'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-3' ELSE color END WHERE name IN ('Home', 'בית') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🎟️'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-7' ELSE color END WHERE name IN ('Leisure', 'פנאי') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🧸'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-5' ELSE color END WHERE name IN ('Kids', 'ילדים') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🎁'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-8' ELSE color END WHERE name IN ('Gifts & donations', 'מתנות ותרומות') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '✈️'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-1' ELSE color END WHERE name IN ('Travel', 'חופשות') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '💵'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-6' ELSE color END WHERE name IN ('Cash withdrawals', 'משיכות מזומן') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '💳'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-other' ELSE color END WHERE name IN ('Credit card (not split)', 'כרטיס אשראי (לא מפוצל)') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🐾'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-2' ELSE color END WHERE name IN ('Pets', 'חיות מחמד') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '💅'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-5' ELSE color END WHERE name IN ('Personal care', 'טיפוח') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🏋️'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-3' ELSE color END WHERE name IN ('Sport & fitness', 'ספורט וכושר') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '📦'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-other' ELSE color END WHERE name IN ('Other', 'אחר') AND kind = 'expense';
UPDATE categories SET emoji = COALESCE(emoji, '🔄'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-other' ELSE color END WHERE name IN ('Internal transfers', 'העברות פנימיות') AND kind = 'transfer';
UPDATE categories SET emoji = COALESCE(emoji, '🐷'), color = CASE WHEN color IS NULL OR color NOT LIKE 'cat-%' THEN 'cat-7' ELSE color END WHERE name IN ('Savings & investments', 'חיסכון והשקעות') AND kind = 'transfer';

DROP VIEW v_lines;
CREATE VIEW v_lines AS
SELECT t.household_id, t.id AS tx_id, NULL AS split_id, t.account_id, t.date, t.amount_minor,
       COALESCE(pc.parent_id, t.category_id) AS category_id, t.category_id AS sub_category_id, t.kind, t.recurring_id, t.planned_id
  FROM transactions t LEFT JOIN categories pc ON pc.id = t.category_id AND pc.household_id = t.household_id
 WHERE t.has_splits = 0
UNION ALL
SELECT t.household_id, t.id, s.id, t.account_id, t.date, s.amount_minor,
       COALESCE(pc.parent_id, s.category_id), s.category_id, t.kind, t.recurring_id, t.planned_id
  FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id AND t.household_id = s.household_id
  LEFT JOIN categories pc ON pc.id = s.category_id AND pc.household_id = s.household_id;
