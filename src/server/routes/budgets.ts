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
 * Recurring (default): sets limits from `month` on; earlier months keep their values (AC5.1); null removes
 * the budget from M. Either way it replaces a one-time limit in M.
 * oneTime: the limit applies to `month` only; null removes that one-time limit (the recurring one shows again).
 */
budgetRoutes.put('/', async (c) => {
  const b = await body(c, z.object({ month: monthStr, items: z.array(z.object({ categoryId: id, limitMinor: z.number().int().min(0).max(1e11).nullable(), oneTime: z.boolean().optional() }).strict()).min(1).max(100) }).strict());
  const { db } = tctx(c);
  await db.assertOwned({ categories: b.items.map((i) => i.categoryId) });
  const kinds = await db.all<{ id: string; kind: string }>('SELECT id, kind FROM categories WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2))', JSON.stringify(b.items.map((i) => i.categoryId)));
  if (kinds.some((k) => k.kind !== 'expense')) throw new HttpError(400, 'not_expense_category', 'Only expense categories can be budgeted');
  const dropOneTime = (cid: string) => db.stmt('DELETE FROM budgets WHERE household_id = ?1 AND category_id = ?2 AND effective_from = ?3 AND one_time = 1', cid, b.month);
  await db.batch(
    b.items.flatMap((i) => {
      if (i.oneTime && i.limitMinor === null) return [dropOneTime(i.categoryId)];
      const upsert = db.stmt(
        `INSERT INTO budgets (id, household_id, category_id, effective_from, limit_minor, one_time) SELECT ?2, ?1, ?3, ?4, ?5, ?6
          WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?3)
         ON CONFLICT(household_id, category_id, effective_from, one_time) DO UPDATE SET limit_minor = excluded.limit_minor`,
        newId(),
        i.categoryId,
        b.month,
        i.limitMinor,
        i.oneTime ? 1 : 0,
      );
      return i.oneTime ? [upsert] : [dropOneTime(i.categoryId), upsert];
    }),
  );
  return c.json({ ok: true });
});
