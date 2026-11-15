import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { body, notFound } from '../http';
import { dateStr, minor, posMinor, text } from '../../shared/schemas/common';
import { monthOf } from '../../shared/dates';
import { newId, nowIso } from '../lib/crypto';
import { loadBase } from '../db/sql/facts';
import { healthBundle } from '../db/sql/health';

export const goalRoutes = tenantGroup();
export const healthRoutes = tenantGroup();

const goalCreate = z
  .object({
    name: text(60).min(1),
    description: text(300).optional(),
    targetMinor: posMinor.refine((v) => v > 0),
    startMinor: posMinor.optional(),
    startDate: dateStr.optional(),
    targetDate: dateStr.nullable().optional(),
    priority: z.number().int().min(1).max(5).optional(),
  })
  .strict();
const goalPatch = goalCreate.partial().extend({ status: z.enum(['active', 'completed', 'archived']).optional() }).strict();
const contribCreate = z.object({ date: dateStr, amountMinor: minor.refine((v) => v !== 0), note: text(120).optional() }).strict();

goalRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const b = await healthBundle(db, base, monthOf(base.today), 1);
  const contribs = await db.all<{ id: string; goal_id: string; date: string; amount_minor: number; note: string | null }>('SELECT id, goal_id, date, amount_minor, note FROM goal_contributions WHERE household_id = ?1 ORDER BY date DESC');
  return c.json({ goals: b.goals, summary: b.goalsSummary, contributions: contribs.map((x) => ({ id: x.id, goalId: x.goal_id, date: x.date, amountMinor: x.amount_minor, note: x.note })), today: base.today });
});

goalRoutes.post('/', async (c) => {
  const b = await body(c, goalCreate);
  const { db, hh } = tctx(c);
  const id = newId();
  const today = (await loadBase(db, hh)).today;
  await db.insert('goals', { id, name: b.name, description: b.description || null, target_minor: b.targetMinor, start_minor: b.startMinor ?? 0, start_date: b.startDate ?? today, target_date: b.targetDate ?? null, priority: b.priority ?? 2, status: 'active', created_at: nowIso() });
  return c.json({ id }, 201);
});

goalRoutes.patch('/:id', async (c) => {
  const b = await body(c, goalPatch);
  const { db } = tctx(c);
  const r = await db.run(
    `UPDATE goals SET name = COALESCE(?3, name), description = COALESCE(?4, description), target_minor = COALESCE(?5, target_minor), start_minor = COALESCE(?6, start_minor),
       start_date = COALESCE(?7, start_date), target_date = CASE WHEN ?8 = 1 THEN ?9 ELSE target_date END, priority = COALESCE(?10, priority), status = COALESCE(?11, status)
     WHERE household_id = ?1 AND id = ?2`,
    c.req.param('id'),
    b.name ?? null,
    b.description ?? null,
    b.targetMinor ?? null,
    b.startMinor ?? null,
    b.startDate ?? null,
    b.targetDate !== undefined ? 1 : 0,
    b.targetDate ?? null,
    b.priority ?? null,
    b.status ?? null,
  );
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

goalRoutes.delete('/:id', async (c) => {
  const { db } = tctx(c);
  const r = await db.run('DELETE FROM goals WHERE household_id = ?1 AND id = ?2', c.req.param('id'));
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** Contribution; the goal is marked completed when it reaches 100 % (AC8.3). */
goalRoutes.post('/:id/contributions', async (c) => {
  const b = await body(c, contribCreate);
  const { db } = tctx(c);
  const gid = c.req.param('id');
  if (!(await db.owns('goals', gid))) throw notFound();
  const id = newId();
  await db.batch([
    db.insertStmt('goal_contributions', { id, goal_id: gid, date: b.date, amount_minor: b.amountMinor, note: b.note || null }),
    db.stmt(
      `UPDATE goals SET status = CASE WHEN start_minor + (SELECT COALESCE(SUM(amount_minor), 0) FROM goal_contributions WHERE household_id = ?1 AND goal_id = ?2) >= target_minor
                                      THEN 'completed' ELSE (CASE WHEN status = 'completed' THEN 'active' ELSE status END) END
        WHERE household_id = ?1 AND id = ?2 AND status <> 'archived'`,
      gid,
    ),
  ]);
  return c.json({ id }, 201);
});

goalRoutes.delete('/:id/contributions/:cid', async (c) => {
  const { db } = tctx(c);
  const gid = c.req.param('id');
  const r = await db.run('DELETE FROM goal_contributions WHERE household_id = ?1 AND goal_id = ?2 AND id = ?3', gid, c.req.param('cid'));
  if (!r.meta.changes) throw notFound();
  await db.run(
    `UPDATE goals SET status = 'active' WHERE household_id = ?1 AND id = ?2 AND status = 'completed'
       AND start_minor + (SELECT COALESCE(SUM(amount_minor), 0) FROM goal_contributions WHERE household_id = ?1 AND goal_id = ?2) < target_minor`,
    gid,
  );
  return c.json({ ok: true });
});

healthRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const qv = z.object({ months: z.coerce.number().int().min(1).max(12).optional() }).safeParse(c.req.query());
  const base = await loadBase(db, hh);
  const b = await healthBundle(db, base, monthOf(base.today), qv.success ? (qv.data.months ?? 6) : 6);
  return c.json({
    month: b.current.month,
    overall: b.current.result.overall,
    label: b.current.result.label,
    subs: b.current.result.subs,
    input: b.current.input,
    change: b.change,
    trend: b.months.map((m) => ({ month: m.month, overall: m.result.overall })),
    recommendations: b.recommendations,
  });
});
