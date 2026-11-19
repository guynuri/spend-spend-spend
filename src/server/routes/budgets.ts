import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, query } from '../http';
import { id, monthStr } from '../../shared/schemas/common';
import { displayMonth } from '../../shared/domain/common';
import { newId } from '../lib/crypto';
import { loadBase } from '../db/sql/facts';
import { computeBudget } from '../db/sql/budget';

export const budgetRoutes = tenantGroup();

budgetRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ month: monthStr.optional() }));
  const base = await loadBase(db, hh);
  const month = qv.month ?? displayMonth(base.today, base.latestTx).month;
  return c.json({ ...(await computeBudget(db, base, month)), asOf: base.asOf, today: base.today });
});

/**
 * Three kinds of item:
 * - `{ categoryId, limitMinor, oneTime? }` a monthly category. Recurring (default): sets limits from `month` on;
 *   earlier months keep their values (AC5.1); null removes the budget from M. Either way it replaces a one-time
 *   limit in M. oneTime: the limit applies to `month` only; null removes that one-time limit.
 * - `{ general: true, limitMinor, oneTime? }` the shared monthly limit of the general-expenses pool (same rules).
 * - `{ categoryId, limitMinor, yearly: true }` an occasional category's limit for `month`'s year and later years.
 */
const monthlyItem = z.object({ categoryId: id, limitMinor: z.number().int().min(0).max(1e11).nullable(), oneTime: z.boolean().optional() }).strict();
const generalItem = z.object({ general: z.literal(true), limitMinor: z.number().int().min(0).max(1e11).nullable(), oneTime: z.boolean().optional() }).strict();
const yearlyItem = z.object({ categoryId: id, limitMinor: z.number().int().min(0).max(1e12).nullable(), yearly: z.literal(true) }).strict();
type Item = z.infer<typeof monthlyItem> | z.infer<typeof generalItem> | z.infer<typeof yearlyItem>;

budgetRoutes.put('/', async (c) => {
  const b = await body(c, z.object({ month: monthStr, items: z.array(z.union([generalItem, yearlyItem, monthlyItem])).min(1).max(100) }).strict());
  const { db } = tctx(c);
  const items = b.items as Item[];
  const catItems = items.filter((i): i is Exclude<Item, { general: true }> => 'categoryId' in i);
  await db.assertOwned({ categories: catItems.map((i) => i.categoryId) });
  const cats = await db.all<{ id: string; kind: string; budget_mode: string }>(
    'SELECT id, kind, budget_mode FROM categories WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2))',
    JSON.stringify(catItems.map((i) => i.categoryId)),
  );
  if (cats.some((k) => k.kind !== 'expense')) throw new HttpError(400, 'not_expense_category', 'Only expense categories can be budgeted');
  const mode = new Map(cats.map((k) => [k.id, k.budget_mode]));
  for (const i of catItems) {
    // removing a monthly limit is always allowed (e.g. one left over from before the category changed mode)
    if (!('yearly' in i) && i.limitMinor === null) continue;
    const want = 'yearly' in i ? 'occasional' : 'monthly';
    if (mode.get(i.categoryId) !== want) throw new HttpError(400, 'wrong_budget_mode', want === 'occasional' ? 'Yearly budgets are for occasional categories' : 'This category is budgeted with the general expenses or yearly');
  }
  const year = b.month.slice(0, 4);
  const monthly = (table: 'budgets' | 'general_budgets', cid: string | null, limitMinor: number | null, oneTime: boolean | undefined) => {
    const cat = table === 'budgets' ? ' AND category_id = ?3' : '';
    const dropOneTime = db.stmt(`DELETE FROM ${table} WHERE household_id = ?1 AND effective_from = ?2 AND one_time = 1${cat}`, b.month, ...(cid ? [cid] : []));
    if (oneTime && limitMinor === null) return [dropOneTime];
    const upsert =
      table === 'budgets'
        ? db.stmt(
            `INSERT INTO budgets (id, household_id, category_id, effective_from, limit_minor, one_time) SELECT ?2, ?1, ?3, ?4, ?5, ?6
              WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?3)
             ON CONFLICT(household_id, category_id, effective_from, one_time) DO UPDATE SET limit_minor = excluded.limit_minor`,
            newId(),
            cid,
            b.month,
            limitMinor,
            oneTime ? 1 : 0,
          )
        : db.stmt(
            `INSERT INTO general_budgets (id, household_id, effective_from, limit_minor, one_time) VALUES (?2, ?1, ?3, ?4, ?5)
             ON CONFLICT(household_id, effective_from, one_time) DO UPDATE SET limit_minor = excluded.limit_minor WHERE general_budgets.household_id = ?1`,
            newId(),
            b.month,
            limitMinor,
            oneTime ? 1 : 0,
          );
    return oneTime ? [upsert] : [dropOneTime, upsert];
  };
  await db.batch(
    items.flatMap((i) => {
      if ('general' in i) return monthly('general_budgets', null, i.limitMinor, i.oneTime);
      if ('yearly' in i)
        return [
          db.stmt(
            `INSERT INTO yearly_budgets (id, household_id, category_id, year, limit_minor) SELECT ?2, ?1, ?3, ?4, ?5
              WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?3)
             ON CONFLICT(household_id, category_id, year) DO UPDATE SET limit_minor = excluded.limit_minor`,
            newId(),
            i.categoryId,
            year,
            i.limitMinor,
          ),
        ];
      return monthly('budgets', i.categoryId, i.limitMinor, i.oneTime);
    }),
  );
  return c.json({ ok: true });
});
