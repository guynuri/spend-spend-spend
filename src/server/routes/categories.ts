import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound } from '../http';
import { categoryCreate, categoryPatch, type Category } from '../../shared/schemas/ledger';
import { newId } from '../lib/crypto';
import type { Ctx } from '../types';
import { DEFAULT_CATEGORIES, categoryRow, seedRuleRows } from '../seed/defaults';

export const categoryRoutes = tenantGroup();

export const mapCategory = (r: Record<string, unknown>): Category => ({
  id: r.id as string,
  name: r.name as string,
  kind: r.kind as Category['kind'],
  grp: (r.grp as Category['grp']) ?? null,
  isDebt: r.is_debt === 1,
  systemKey: (r.system_key as string) ?? null,
  icon: (r.icon as string) ?? null,
  sort: r.sort as number,
  archived: r.archived === 1,
});

categoryRoutes.get('/', async (c) => {
  const { db } = tctx(c);
  const rows = await db.all('SELECT * FROM categories WHERE household_id = ?1 ORDER BY archived, sort, name');
  return c.json({ categories: rows.map(mapCategory) });
});

const locale = (c: Ctx) => {
  const h = c.req.header('x-mz-locale');
  return h === 'he' || h === 'en' ? h : tctx(c).hh.locale === 'he' ? 'he' : 'en';
};

/** References that make a category "in use"; `cat` is the category id SQL expression. */
const usageSql = (cat: string) => `(SELECT COUNT(*) FROM transactions WHERE household_id = ?1 AND category_id = ${cat})
  + (SELECT COUNT(*) FROM transaction_splits WHERE household_id = ?1 AND category_id = ${cat})
  + (SELECT COUNT(*) FROM budgets WHERE household_id = ?1 AND category_id = ${cat})
  + (SELECT COUNT(*) FROM recurring_items WHERE household_id = ?1 AND category_id = ${cat})
  + (SELECT COUNT(*) FROM planned_expenses WHERE household_id = ?1 AND category_id = ${cat})`;

/** Catalog of default categories the household does not have (active): one tap to add. */
categoryRoutes.get('/suggestions', async (c) => {
  const { db } = tctx(c);
  const active = new Set((await db.all<{ name: string }>('SELECT name FROM categories WHERE household_id = ?1 AND archived = 0')).map((r) => r.name));
  const suggestions = DEFAULT_CATEGORIES.filter((d) => !d.systemKey && !active.has(d.en) && !active.has(d.he)).map((d) => ({ key: d.key, en: d.en, he: d.he, kind: d.kind }));
  return c.json({ suggestions });
});

/** Adds a catalog category (with its built-in rules), or restores it when archived. */
categoryRoutes.post('/suggestions/:key', async (c) => {
  const d = DEFAULT_CATEGORIES.find((x) => x.key === c.req.param('key') && !x.systemKey);
  if (!d) throw notFound();
  const { db } = tctx(c);
  const hit = await db.first<{ id: string }>('SELECT id FROM categories WHERE household_id = ?1 AND name IN (?2, ?3)', d.en, d.he);
  if (hit) {
    await db.run('UPDATE categories SET archived = 0 WHERE household_id = ?1 AND id = ?2', hit.id);
    return c.json({ id: hit.id });
  }
  const max = await db.first<{ m: number }>('SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE household_id = ?1');
  const row = categoryRow(d, locale(c), (max?.m ?? 0) + 1);
  await db.batch([
    ...db.bulkInsertStmts('categories', Object.keys(row), [row]),
    ...seedRuleRows(new Map([[d.key, row.id]])).map((r) =>
      db.stmt(
        `INSERT INTO category_rules (id, household_id, field, match, pattern_norm, sign, category_id, source, created_at)
         SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, 'seed', ?8 WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?7)
         ON CONFLICT(household_id, field, match, pattern_norm, sign) DO NOTHING`,
        r.id,
        r.field,
        r.match,
        r.pattern_norm,
        r.sign,
        r.category_id,
        r.created_at,
      ),
    ),
  ]);
  return c.json({ id: row.id }, 201);
});

/** Declutter: archives (never deletes) categories with no transactions, budgets, plans or own rules. */
categoryRoutes.post('/hide-unused', async (c) => {
  const { db } = tctx(c);
  const r = await db.run(
    `UPDATE categories SET archived = 1 WHERE household_id = ?1 AND archived = 0 AND system_key IS NULL
       AND ${usageSql('categories.id')} = 0
       AND NOT EXISTS (SELECT 1 FROM category_rules WHERE household_id = ?1 AND category_id = categories.id AND source <> 'seed')`,
  );
  return c.json({ hidden: r.meta.changes ?? 0 });
});

categoryRoutes.post('/', async (c) => {
  const b = await body(c, categoryCreate);
  const { db } = tctx(c);
  const dup = await db.first('SELECT id FROM categories WHERE household_id = ?1 AND name = ?2', b.name);
  if (dup) throw new HttpError(409, 'name_taken', 'Name already used');
  const id = newId();
  const max = await db.first<{ m: number }>('SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE household_id = ?1');
  await db.insert('categories', { id, name: b.name, kind: b.kind, grp: b.kind === 'expense' ? (b.grp ?? 'variable') : null, is_debt: b.isDebt ?? 0, sort: (max?.m ?? 0) + 1 });
  return c.json({ id }, 201);
});

categoryRoutes.patch('/:id', async (c) => {
  const b = await body(c, categoryPatch);
  const { db } = tctx(c);
  const id = c.req.param('id');
  if (b.name) {
    const dup = await db.first('SELECT id FROM categories WHERE household_id = ?1 AND name = ?2 AND id <> ?3', b.name, id);
    if (dup) throw new HttpError(409, 'name_taken', 'Name already used');
  }
  const r = await db.run(
    `UPDATE categories SET name = COALESCE(?3, name), grp = CASE WHEN ?4 = 1 AND kind = 'expense' THEN ?5 ELSE grp END,
       is_debt = COALESCE(?6, is_debt), archived = COALESCE(?7, archived), sort = COALESCE(?8, sort)
     WHERE household_id = ?1 AND id = ?2`,
    id,
    b.name ?? null,
    b.grp !== undefined ? 1 : 0,
    b.grp ?? null,
    b.isDebt ?? null,
    b.archived ?? null,
    b.sort ?? null,
  );
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** A category in use is archived, not deleted (AC3.2). System categories are kept. */
categoryRoutes.delete('/:id', async (c) => {
  const { db } = tctx(c);
  const id = c.req.param('id');
  const cat = await db.first<{ system_key: string | null }>('SELECT system_key FROM categories WHERE household_id = ?1 AND id = ?2', id);
  if (!cat) throw notFound();
  if (cat.system_key) throw new HttpError(409, 'system_category', 'System category');
  const u = await db.first<{ n: number }>(
    `SELECT ${usageSql('?2')} AS n`,
    id,
  );
  if (u!.n > 0) {
    await db.run('UPDATE categories SET archived = 1 WHERE household_id = ?1 AND id = ?2', id);
    return c.json({ archived: true });
  }
  await db.run('DELETE FROM categories WHERE household_id = ?1 AND id = ?2', id);
  return c.json({ deleted: true });
});
