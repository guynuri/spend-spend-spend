import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound } from '../http';
import { z } from 'zod';
import { categoryCreate, categoryPatch, type Category } from '../../shared/schemas/ledger';
import { id } from '../../shared/schemas/common';
import { newId } from '../lib/crypto';
import type { Ctx } from '../types';
import { DEFAULT_CATEGORIES, categoryRow, defaultNames, seedRuleRows } from '../seed/defaults';

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
  const rows = await db.all<{ name: string; kind: string }>('SELECT name, kind FROM categories WHERE household_id = ?1 AND archived = 0');
  const active = new Set(rows.map((r) => `${r.kind}|${r.name}`));
  const suggestions = DEFAULT_CATEGORIES.filter((d) => !d.systemKey && !defaultNames(d).some((n) => active.has(`${d.kind}|${n}`))).map((d) => ({ key: d.key, en: d.en, he: d.he, kind: d.kind }));
  return c.json({ suggestions });
});

/** Adds a catalog category (with its built-in rules), or restores it when archived. */
categoryRoutes.post('/suggestions/:key', async (c) => {
  const d = DEFAULT_CATEGORIES.find((x) => x.key === c.req.param('key') && !x.systemKey);
  if (!d) throw notFound();
  const { db } = tctx(c);
  // Same kind only; the current en/he names win over legacy aliases.
  const hit = await db.first<{ id: string }>(
    `SELECT id FROM categories WHERE household_id = ?1 AND kind = ?3 AND name IN (SELECT value FROM json_each(?2))
      ORDER BY CASE WHEN name IN (?4, ?5) THEN 0 ELSE 1 END, archived LIMIT 1`,
    JSON.stringify(defaultNames(d)),
    d.kind,
    d.en,
    d.he,
  );
  if (hit) {
    await db.run('UPDATE categories SET archived = 0 WHERE household_id = ?1 AND id = ?2', hit.id);
    return c.json({ id: hit.id });
  }
  const name = locale(c) === 'he' ? d.he : d.en;
  if (await db.first('SELECT 1 FROM categories WHERE household_id = ?1 AND name = ?2', name)) throw new HttpError(409, 'name_taken', 'Name already used');
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

/** Hideable: active, not system, and no transactions, splits, budgets, plans or own (non-built-in) rules. */
const UNUSED = `archived = 0 AND system_key IS NULL AND ${usageSql('categories.id')} = 0
  AND NOT EXISTS (SELECT 1 FROM category_rules WHERE household_id = ?1 AND category_id = categories.id AND source <> 'seed')`;
/** "Unused" means something only once the household has history in at least two calendar months. */
const hasHistory = async (db: ReturnType<typeof tctx>['db']) =>
  ((await db.first<{ m: number }>('SELECT COUNT(DISTINCT substr(date, 1, 7)) AS m FROM transactions WHERE household_id = ?1'))?.m ?? 0) >= 2;

/** Declutter preview: the categories "Hide unused" would archive (the user confirms or unticks each). */
categoryRoutes.get('/hide-unused', async (c) => {
  const { db } = tctx(c);
  if (!(await hasHistory(db))) return c.json({ eligible: false, candidates: [] });
  const candidates = await db.all<{ id: string; name: string }>(`SELECT id, name FROM categories WHERE household_id = ?1 AND ${UNUSED} ORDER BY sort, name`);
  return c.json({ eligible: true, candidates });
});

/** Archives (never deletes) exactly the confirmed ids that are still unused; hidden ones stop getting rule hits. */
categoryRoutes.post('/hide-unused', async (c) => {
  const b = await body(c, z.object({ ids: z.array(id).min(1).max(200) }).strict());
  const { db } = tctx(c);
  if (!(await hasHistory(db))) throw new HttpError(409, 'no_history', 'Needs transactions in at least two months');
  const r = await db.run(`UPDATE categories SET archived = 1 WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND ${UNUSED}`, JSON.stringify(b.ids));
  return c.json({ hidden: r.meta.changes ?? 0 });
});

categoryRoutes.post('/', async (c) => {
  const b = await body(c, categoryCreate);
  const { db } = tctx(c);
  const dup = await db.first<{ id: string; archived: number; kind: string }>('SELECT id, archived, kind FROM categories WHERE household_id = ?1 AND name = ?2', b.name);
  if (dup?.archived && dup.kind === b.kind) {
    // A hidden category with this name and kind comes back (with the requested group / debt flag).
    await db.run(
      `UPDATE categories SET archived = 0, grp = CASE WHEN kind = 'expense' THEN COALESCE(?3, grp) ELSE grp END, is_debt = COALESCE(?4, is_debt) WHERE household_id = ?1 AND id = ?2`,
      dup.id,
      b.grp ?? null,
      b.isDebt ?? null,
    );
    return c.json({ id: dup.id });
  }
  if (dup?.archived) throw new HttpError(409, 'name_taken_hidden', 'A hidden category of another type has this name');
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
