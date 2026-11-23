-- "Owed to me" (D-R30): a system transfer category for the part of a purchase someone pays back.
-- Added to every household that doesn't have it (new households get it from the defaults).
INSERT INTO categories (id, household_id, name, kind, grp, is_debt, system_key, icon, emoji, color, sort, archived)
SELECT lower(hex(randomblob(11))), h.id, CASE WHEN h.locale = 'he' THEN 'חייבים לי' ELSE 'Owed to me' END, 'transfer', NULL, 0, 'owed', 'handshake', '🤝', 'cat-3',
       COALESCE((SELECT MAX(sort) FROM categories c WHERE c.household_id = h.id), 0) + 1, 0
  FROM households h
 WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.household_id = h.id AND c.system_key = 'owed')
   AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.household_id = h.id AND c.name = CASE WHEN h.locale = 'he' THEN 'חייבים לי' ELSE 'Owed to me' END);
