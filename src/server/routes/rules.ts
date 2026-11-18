import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound } from '../http';
import { ruleCreate, ruleLearn, ruleLookup, rulePatch, type Rule } from '../../shared/schemas/ledger';
import { isGenericPayee, learnedRuleFor } from '../../shared/domain/ledger';
import { norm, normKey } from '../../shared/normalize';
import { newId, nowIso } from '../lib/crypto';
import { applyRulesStmt, winningRuleSql } from '../db/sql/rules';

export const ruleRoutes = tenantGroup();

const mapRule = (r: Record<string, unknown>): Rule => ({
  id: r.id as string,
  field: r.field as Rule['field'],
  match: r.match as Rule['match'],
  pattern: r.pattern_norm as string,
  sign: r.sign as Rule['sign'],
  categoryId: r.category_id as string,
  source: r.source as Rule['source'],
  hits: r.hits as number,
});
const patternFor = (field: string, p: string) => (field === 'description' ? normKey(p) : norm(p));

ruleRoutes.get('/', async (c) => {
  const { db } = tctx(c);
  const rows = await db.all(`SELECT * FROM category_rules WHERE household_id = ?1 ORDER BY CASE source WHEN 'user' THEN 0 WHEN 'learned' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END, length(pattern_norm) DESC`);
  return c.json({ rules: rows.map(mapRule) });
});

ruleRoutes.post('/', async (c) => {
  const b = await body(c, ruleCreate);
  const { db } = tctx(c);
  await db.assertOwned({ categories: [b.categoryId] });
  const pattern = patternFor(b.field, b.pattern);
  if (!pattern) throw new HttpError(400, 'validation', 'Empty pattern');
  const id = newId();
  const r = await db.first<{ id: string }>(
    `INSERT INTO category_rules (id, household_id, field, match, pattern_norm, sign, category_id, source, created_at)
     SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, 'user', ?8 WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?7)
     ON CONFLICT(household_id, field, match, pattern_norm, sign) DO UPDATE SET category_id = excluded.category_id, source = 'user'
     RETURNING id`,
    id,
    b.field,
    b.match,
    pattern,
    b.sign,
    b.categoryId,
    nowIso(),
  );
  return c.json({ id: r!.id }, 201);
});

ruleRoutes.patch('/:id', async (c) => {
  const b = await body(c, rulePatch);
  const { db } = tctx(c);
  const id = c.req.param('id');
  const cur = await db.first<{ field: string }>('SELECT field FROM category_rules WHERE household_id = ?1 AND id = ?2', id);
  if (!cur) throw notFound();
  if (b.categoryId) await db.assertOwned({ categories: [b.categoryId] });
  try {
    await db.run(
      `UPDATE category_rules SET match = COALESCE(?3, match), pattern_norm = COALESCE(?4, pattern_norm), sign = COALESCE(?5, sign),
         category_id = COALESCE(?6, category_id), source = 'user' WHERE household_id = ?1 AND id = ?2`,
      id,
      b.match ?? null,
      b.pattern ? patternFor(cur.field, b.pattern) : null,
      b.sign ?? null,
      b.categoryId ?? null,
    );
  } catch {
    throw new HttpError(409, 'rule_exists', 'An identical rule exists');
  }
  return c.json({ ok: true });
});

ruleRoutes.delete('/:id', async (c) => {
  const { db } = tctx(c);
  const r = await db.run('DELETE FROM category_rules WHERE household_id = ?1 AND id = ?2', c.req.param('id'));
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** Re-applies all rules to uncategorized transactions. */
ruleRoutes.post('/apply', async (c) => {
  const { db } = tctx(c);
  const r = await (await applyRulesStmt(db, { kind: 'all' }, nowIso())).run();
  return c.json({ applied: r.meta.changes ?? 0 });
});

/**
 * Learns business → category rules from a card split (one per business and direction), then applies
 * them to uncategorized transactions. A rule the user wrote by hand is never re-pointed; payment apps,
 * transfers, checks and ATM never become rules.
 */
ruleRoutes.post('/learn', async (c) => {
  const b = await body(c, ruleLearn);
  const { db } = tctx(c);
  await db.assertOwned({ categories: b.items.map((i) => i.categoryId) });
  const seen = new Set<string>();
  const items = b.items
    .filter((i) => !isGenericPayee(i.description))
    .map((i) => ({ ...i, key: learnedRuleFor(i) }))
    .filter((i) => i.key.pattern_norm && !seen.has(`${i.key.sign}|${i.key.pattern_norm}`) && seen.add(`${i.key.sign}|${i.key.pattern_norm}`));
  if (!items.length) return c.json({ learned: 0, skipped: b.items.length, applied: 0 });
  const now = nowIso();
  const res = await db.batch(
    items.map((i) =>
      db.stmt(
        `INSERT INTO category_rules (id, household_id, field, match, pattern_norm, sign, category_id, source, created_at)
         SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?7)
         ON CONFLICT(household_id, field, match, pattern_norm, sign) DO UPDATE SET category_id = excluded.category_id, source = excluded.source
           WHERE category_rules.source <> 'user'`,
        newId(),
        i.key.field,
        i.key.match,
        i.key.pattern_norm,
        i.key.sign,
        i.categoryId,
        i.source,
        now,
      ),
    ),
  );
  const learned = res.reduce((a, r) => a + (r.meta.changes ?? 0), 0);
  const applied = learned ? ((await (await applyRulesStmt(db, { kind: 'all' }, now)).run()).meta.changes ?? 0) : 0;
  return c.json({ learned, skipped: b.items.length - learned, applied });
});

/** Winning rule category per row (null when none), for rows that are not transactions yet. */
ruleRoutes.post('/match', async (c) => {
  const b = await body(c, ruleLookup);
  const { db } = tctx(c);
  const rows = await db.all<{ i: number; c: string | null }>(
    `SELECT CAST(j.key AS INTEGER) AS i, ${winningRuleSql({ hh: '?1', amount: "json_extract(j.value, '$[1]')", dn: "json_extract(j.value, '$[0]')", op: 'NULL', select: 'r.category_id' })} AS c FROM json_each(?2) j`,
    JSON.stringify(b.items.map((x) => [normKey(x.description), x.amountMinor])),
  );
  const out: (string | null)[] = b.items.map(() => null);
  for (const r of rows) out[r.i] = r.c;
  return c.json({ categoryIds: out });
});
