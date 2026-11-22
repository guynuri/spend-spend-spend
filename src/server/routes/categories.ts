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
  budgetMode: (r.budget_mode as Category['budgetMode']) ?? 'monthly',
  systemKey: (r.system_key as string) ?? null,
  icon: (r.icon as string) ?? null,
  color: (r.color as string) ?? null,
  emoji: (r.emoji as string) ?? null,
  parentId: (r.parent_id as string) ?? null,
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
  + (SELECT COUNT(*) FROM yearly_budgets WHERE household_id = ?1 AND category_id = ${cat})
  + (SELECT COUNT(*) FROM recurring_items WHERE household_id = ?1 AND category_id = ${cat})
  + (SELECT COUNT(*) FROM planned_expenses WHERE household_id = ?1 AND category_id = ${cat})`;

/** Catalog of default categories the household does not have (active): one tap to add. */
categoryRoutes.get('/suggestions', async (c) => {
  const { db } = tctx(c);
  const rows = await db.all<{ name: string; kind: string }>('SELECT name, kind FROM categories WHERE household_id = ?1 AND archived = 0');
  const active = new Set(rows.map((r) => `${r.kind}|${r.name}`));
  const suggestions = DEFAULT_CATEGORIES.filter((d) => !d.systemKey && !defaultNames(d).some((n) => active.has(`${d.kind}|${n}`))).map((d) => ({ key: d.key, en: d.en, he: d.he, kind: d.kind, emoji: d.emoji, color: d.color }));
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
  AND NOT EXISTS (SELECT 1 FROM category_rules WHERE household_id = ?1 AND category_id = categories.id AND source <> 'seed')
  AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.household_id = ?1 AND ch.parent_id = categories.id AND ch.archived = 0)`;
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

/** A parent a subcategory may go under: top-level, not a system category, active, same kind. */
async function parentFor(db: ReturnType<typeof tctx>['db'], parentId: string, kind?: string) {
  const p = await db.first<{ id: string; kind: string; grp: string | null; is_debt: number; budget_mode: string; parent_id: string | null; system_key: string | null; archived: number }>(
    'SELECT id, kind, grp, is_debt, budget_mode, parent_id, system_key, archived FROM categories WHERE household_id = ?1 AND id = ?2',
    parentId,
  );
  if (!p) throw notFound();
  if (p.parent_id || p.system_key || p.archived || (kind && p.kind !== kind)) throw new HttpError(409, 'bad_parent', 'Subcategories go under an active top-level category of the same kind');
  return p;
}

categoryRoutes.post('/', async (c) => {
  const b = await body(c, categoryCreate);
  const { db } = tctx(c);
  const parent = b.parentId ? await parentFor(db, b.parentId, b.kind) : null;
  const dup = await db.first<{ id: string; archived: number; kind: string }>('SELECT id, archived, kind FROM categories WHERE household_id = ?1 AND name = ?2', b.name);
  if (dup?.archived && dup.kind === b.kind) {
    // A hidden category with this name and kind comes back (with the requested group / debt flag / parent / look).
    await db.run(
      `UPDATE categories SET archived = 0, grp = CASE WHEN kind = 'expense' THEN COALESCE(?3, grp) ELSE grp END, is_debt = COALESCE(?4, is_debt),
         budget_mode = CASE WHEN kind = 'expense' AND system_key IS NULL THEN COALESCE(?5, budget_mode) ELSE budget_mode END,
         parent_id = CASE WHEN NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.household_id = ?1 AND ch.parent_id = ?2) THEN ?6 ELSE NULL END,
         emoji = COALESCE(?7, emoji), color = COALESCE(?8, color)
       WHERE household_id = ?1 AND id = ?2`,
      dup.id,
      parent ? parent.grp : (b.grp ?? null),
      parent ? parent.is_debt : (b.isDebt ?? null),
      parent ? parent.budget_mode : (b.budgetMode ?? null),
      parent?.id ?? null,
      b.emoji ?? null,
      b.color ?? null,
    );
    return c.json({ id: dup.id });
  }
  if (dup?.archived) throw new HttpError(409, 'name_taken_hidden', 'A hidden category of another type has this name');
  if (dup) throw new HttpError(409, 'name_taken', 'Name already used');
  const id = newId();
  const max = await db.first<{ m: number }>('SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE household_id = ?1');
  // A subcategory takes the parent's group, debt flag and budget mode (its spending rolls up into the parent).
  await db.insert('categories', {
    id,
    name: b.name,
    kind: b.kind,
    grp: parent ? parent.grp : b.kind === 'expense' ? (b.grp ?? 'variable') : null,
    is_debt: parent ? parent.is_debt : (b.isDebt ?? 0),
    budget_mode: parent ? parent.budget_mode : b.kind === 'expense' ? (b.budgetMode ?? 'monthly') : 'monthly',
    parent_id: parent?.id ?? null,
    emoji: b.emoji ?? null,
    color: b.color ?? null,
    sort: (max?.m ?? 0) + 1,
  });
  return c.json({ id }, 201);
});

categoryRoutes.patch('/:id', async (c) => {
  const b = await body(c, categoryPatch);
  const { db } = tctx(c);
  const id = c.req.param('id');
  const cur = await db.first<{ kind: string; parent_id: string | null; system_key: string | null }>('SELECT kind, parent_id, system_key FROM categories WHERE household_id = ?1 AND id = ?2', id);
  if (!cur) throw notFound();
  if (b.name) {
    const dup = await db.first('SELECT id FROM categories WHERE household_id = ?1 AND name = ?2 AND id <> ?3', b.name, id);
    if (dup) throw new HttpError(409, 'name_taken', 'Name already used');
  }
  let parent: Awaited<ReturnType<typeof parentFor>> | null = null;
  if (b.parentId) {
    if (b.parentId === id || cur.system_key) throw new HttpError(409, 'bad_parent', 'Not a valid parent');
    if (await db.first('SELECT 1 FROM categories WHERE household_id = ?1 AND parent_id = ?2', id)) throw new HttpError(409, 'has_subcategories', 'A category with subcategories cannot become one');
    parent = await parentFor(db, b.parentId, cur.kind);
  }
  // Settings that come from the parent can't be set on a subcategory directly.
  const isSub = b.parentId !== undefined ? !!b.parentId : !!cur.parent_id;
  const grp = parent ? parent.grp : isSub ? undefined : b.grp;
  const mode = parent ? parent.budget_mode : isSub ? undefined : b.budgetMode;
  const debt = parent ? parent.is_debt : isSub ? undefined : b.isDebt;
  const r = await db.run(
    `UPDATE categories SET name = COALESCE(?3, name), grp = CASE WHEN ?4 = 1 AND kind = 'expense' THEN ?5 ELSE grp END,
       is_debt = COALESCE(?6, is_debt), archived = COALESCE(?7, archived), sort = COALESCE(?8, sort),
       budget_mode = CASE WHEN kind = 'expense' AND system_key IS NULL THEN COALESCE(?9, budget_mode) ELSE budget_mode END,
       parent_id = CASE WHEN ?10 = 1 THEN ?11 ELSE parent_id END,
       emoji = CASE WHEN ?12 = 1 THEN ?13 ELSE emoji END, color = COALESCE(?14, color)
     WHERE household_id = ?1 AND id = ?2`,
    id,
    b.name ?? null,
    grp !== undefined ? 1 : 0,
    grp ?? null,
    debt ?? null,
    b.archived ?? null,
    b.sort ?? null,
    mode ?? null,
    b.parentId !== undefined ? 1 : 0,
    b.parentId ?? null,
    b.emoji !== undefined ? 1 : 0,
    b.emoji ?? null,
    b.color ?? null,
  );
  if (!r.meta.changes) throw notFound();
  // A parent's group, debt flag, budget mode and archiving carry to its subcategories.
  await db.run(
    `UPDATE categories SET grp = p.grp, is_debt = p.is_debt, budget_mode = p.budget_mode, archived = CASE WHEN ?3 = 1 THEN p.archived ELSE categories.archived END
       FROM (SELECT grp, is_debt, budget_mode, archived FROM categories WHERE household_id = ?1 AND id = ?2) AS p
     WHERE categories.household_id = ?1 AND categories.parent_id = ?2`,
    id,
    b.archived !== undefined ? 1 : 0,
  );
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
  const subs = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM categories WHERE household_id = ?1 AND parent_id = ?2', id);
  if (u!.n > 0 || subs!.n > 0) {
    // In use, or has subcategories: archived with its subcategories (their history keeps its place).
    await db.run('UPDATE categories SET archived = 1 WHERE household_id = ?1 AND (id = ?2 OR parent_id = ?2)', id);
    return c.json({ archived: true });
  }
  await db.run('DELETE FROM categories WHERE household_id = ?1 AND id = ?2', id);
  return c.json({ deleted: true });
});
