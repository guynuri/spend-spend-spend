import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound, query } from '../http';
import { recurringCreate, recurringPatch, overridePut, plannedCreate, plannedPatch, type PlannedDto, type RecurringDto } from '../../shared/schemas/plan';
import { addDays } from '../../shared/dates';
import { normKey } from '../../shared/normalize';
import { occurrences, recurringTotals, expectedAmount, type RecItem } from '../../shared/domain/recurring';
import { dateStr } from '../../shared/schemas/common';
import { newId, nowIso } from '../lib/crypto';
import { loadBase } from '../db/sql/facts';
import { forecastFor } from '../db/sql/forecast';
import { parseRecurring, recurringStmts } from '../db/sql/recurringData';
import { afterTransactionsWritten } from '../db/sql/linking';
import { runDetection } from '../db/sql/detection';
import type { TenantDb } from '../db/tenant';

export const recurringRoutes = tenantGroup();
export const plannedRoutes = tenantGroup();
export const forecastRoutes = tenantGroup();
export const upcomingRoutes = tenantGroup();

const signed = (kind: string, amount: number) => (kind === 'income' ? Math.abs(amount) : -Math.abs(amount));

/** Re-links recent unlinked transactions after the registry changes. */
async function relink(q: TenantDb, today: string) {
  const ids = await q.all<{ id: string }>('SELECT id FROM transactions WHERE household_id = ?1 AND recurring_id IS NULL AND date >= ?2', addDays(today, -120));
  if (ids.length) await afterTransactionsWritten(q, { ids: ids.map((r) => r.id) }, today);
}

recurringRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const { items, overrides, settled } = parseRecurring(await db.batch(recurringStmts(db, addDays(base.today, -400))));
  const expected = new Map<string, number>();
  const dtos: RecurringDto[] = items.map((it) => {
    const occ = occurrences(it, addDays(base.today, -10), addDays(base.today, 400), overrides, settled).find((o) => !o.settled && !o.skipped && o.due >= addDays(base.today, -5));
    const mine = settled.filter((s) => s.recurring_id === it.id).sort((a, b) => (a.due < b.due ? 1 : -1));
    expected.set(it.id, occ?.amountMinor ?? expectedAmount(it, undefined, mine.map((s) => s.amount_minor)));
    return {
      id: it.id,
      name: it.name,
      kind: it.kind,
      amountMinor: it.amount_minor,
      amountMode: it.amount_mode,
      cadence: it.cadence,
      dayOfMonth: it.day_of_month,
      anchorDate: it.anchor_date,
      startDate: it.start_date,
      endDate: it.end_date,
      accountId: it.account_id,
      categoryId: it.category_id,
      matchNorm: it.match_norm,
      status: it.status,
      source: (it as RecItem & { source: string }).source,
      next: occ ? { due: occ.due, amountMinor: occ.amountMinor, overridden: occ.overridden } : null,
      lastSettled: mine.slice(0, 3).map((s) => ({ due: s.due, amountMinor: s.amount_minor })),
    };
  });
  return c.json({ items: dtos.filter((d) => d.status !== 'dismissed'), totals: recurringTotals(items, expected), today: base.today });
});

recurringRoutes.post('/', async (c) => {
  const b = await body(c, recurringCreate);
  const { db, hh } = tctx(c);
  await db.assertOwned({ accounts: [b.accountId], categories: [b.categoryId] });
  const id = newId();
  await db.insert('recurring_items', {
    id,
    name: b.name,
    kind: b.kind,
    amount_minor: signed(b.kind, b.amountMinor),
    amount_mode: b.amountMode ?? (b.kind === 'card_charge' ? 'estimated' : 'fixed'),
    cadence: b.cadence,
    day_of_month: b.cadence === 'weekly' ? null : (b.dayOfMonth ?? Number(b.anchorDate.slice(8))),
    anchor_date: b.anchorDate,
    start_date: b.startDate ?? null,
    end_date: b.endDate ?? null,
    account_id: b.accountId ?? null,
    category_id: b.categoryId ?? null,
    match_norm: b.kind === 'card_charge' && !b.matchText ? '' : normKey(b.matchText || b.name),
    status: 'active',
    source: 'user',
    created_at: nowIso(),
  });
  const base = await loadBase(db, hh);
  await relink(db, base.today);
  return c.json({ id }, 201);
});

recurringRoutes.patch('/:id', async (c) => {
  const b = await body(c, recurringPatch);
  const { db, hh } = tctx(c);
  const id = c.req.param('id');
  const cur = await db.first<{ kind: string; amount_minor: number }>('SELECT kind, amount_minor FROM recurring_items WHERE household_id = ?1 AND id = ?2', id);
  if (!cur) throw notFound();
  await db.assertOwned({ accounts: [b.accountId], categories: [b.categoryId] });
  const kind = b.kind ?? cur.kind;
  await db.run(
    `UPDATE recurring_items SET name = COALESCE(?3, name), kind = ?4, amount_minor = ?5, amount_mode = COALESCE(?6, amount_mode), cadence = COALESCE(?7, cadence),
       day_of_month = CASE WHEN ?8 = 1 THEN ?9 ELSE day_of_month END, anchor_date = COALESCE(?10, anchor_date),
       start_date = CASE WHEN ?11 = 1 THEN ?12 ELSE start_date END, end_date = CASE WHEN ?13 = 1 THEN ?14 ELSE end_date END,
       account_id = CASE WHEN ?15 = 1 THEN ?16 ELSE account_id END, category_id = CASE WHEN ?17 = 1 THEN ?18 ELSE category_id END,
       match_norm = COALESCE(?19, match_norm), status = COALESCE(?20, status)
     WHERE household_id = ?1 AND id = ?2`,
    id,
    b.name ?? null,
    kind,
    signed(kind, b.amountMinor ?? Math.abs(cur.amount_minor)),
    b.amountMode ?? null,
    b.cadence ?? null,
    b.dayOfMonth !== undefined ? 1 : 0,
    b.dayOfMonth ?? null,
    b.anchorDate ?? null,
    b.startDate !== undefined ? 1 : 0,
    b.startDate ?? null,
    b.endDate !== undefined ? 1 : 0,
    b.endDate ?? null,
    b.accountId !== undefined ? 1 : 0,
    b.accountId ?? null,
    b.categoryId !== undefined ? 1 : 0,
    b.categoryId ?? null,
    b.matchText !== undefined ? normKey(b.matchText) : null,
    b.status ?? null,
  );
  if (b.status === 'active' || b.matchText !== undefined || b.amountMinor !== undefined) await relink(db, (await loadBase(db, hh)).today);
  return c.json({ ok: true });
});

recurringRoutes.delete('/:id', async (c) => {
  const { db } = tctx(c);
  const id = c.req.param('id');
  if (!(await db.owns('recurring_items', id))) throw notFound();
  await db.batch([
    db.stmt('UPDATE transactions SET recurring_id = NULL, recurring_due = NULL WHERE household_id = ?1 AND recurring_id = ?2', id),
    db.stmt('UPDATE planned_expenses SET card_recurring_id = NULL WHERE household_id = ?1 AND card_recurring_id = ?2', id),
    db.stmt('DELETE FROM recurring_items WHERE household_id = ?1 AND id = ?2', id),
  ]);
  return c.json({ ok: true });
});

recurringRoutes.post('/detect', async (c) => {
  const { db, hh } = tctx(c);
  const created = await runDetection(db, (await loadBase(db, hh)).today);
  return c.json({ created });
});

/** Per-occurrence override: "I expect ₪X on the 10th" or skip (AC6.3, AC6.4). */
recurringRoutes.put('/:id/overrides/:dueDate', async (c) => {
  const b = await body(c, overridePut);
  const { db } = tctx(c);
  const id = c.req.param('id');
  const due = dateStr.safeParse(c.req.param('dueDate'));
  if (!due.success) throw new HttpError(400, 'validation', 'Bad date');
  if (!(await db.owns('recurring_items', id))) throw notFound();
  if ((b.amountMinor === null || b.amountMinor === undefined) && !b.skipped) {
    await db.run('DELETE FROM recurring_overrides WHERE household_id = ?1 AND recurring_id = ?2 AND due_date = ?3', id, due.data);
    return c.json({ ok: true });
  }
  await db.run(
    `INSERT INTO recurring_overrides (id, household_id, recurring_id, due_date, amount_minor, skipped) SELECT ?4, ?1, ?2, ?3, ?5, ?6
      WHERE EXISTS (SELECT 1 FROM recurring_items WHERE household_id = ?1 AND id = ?2)
     ON CONFLICT(recurring_id, due_date) DO UPDATE SET amount_minor = excluded.amount_minor, skipped = excluded.skipped`,
    id,
    due.data,
    newId(),
    b.amountMinor ?? null,
    b.skipped ? 1 : 0,
  );
  return c.json({ ok: true });
});

// ---------------- planned expenses ----------------
const mapPlanned = (r: Record<string, unknown>): PlannedDto => ({
  id: r.id as string,
  name: r.name as string,
  amountMinor: r.amount_minor as number,
  date: r.date as string,
  categoryId: (r.category_id as string) ?? null,
  accountId: (r.account_id as string) ?? null,
  cardRecurringId: (r.card_recurring_id as string) ?? null,
  status: r.status as PlannedDto['status'],
  matchedTxId: (r.matched_tx_id as string) ?? null,
  notes: (r.notes as string) ?? null,
});

plannedRoutes.get('/', async (c) => {
  const { db } = tctx(c);
  const rows = await db.all("SELECT * FROM planned_expenses WHERE household_id = ?1 ORDER BY CASE status WHEN 'planned' THEN 0 ELSE 1 END, date");
  return c.json({ planned: rows.map(mapPlanned) });
});

plannedRoutes.post('/', async (c) => {
  const b = await body(c, plannedCreate);
  const { db } = tctx(c);
  await db.assertOwned({ accounts: [b.accountId], categories: [b.categoryId], recurring_items: [b.cardRecurringId] });
  const id = newId();
  await db.insert('planned_expenses', {
    id,
    name: b.name,
    amount_minor: b.direction === 'in' ? b.amountMinor : -b.amountMinor,
    date: b.date,
    category_id: b.categoryId ?? null,
    account_id: b.cardRecurringId ? null : (b.accountId ?? null),
    card_recurring_id: b.cardRecurringId ?? null,
    status: 'planned',
    notes: b.notes || null,
    created_at: nowIso(),
  });
  return c.json({ id }, 201);
});

plannedRoutes.patch('/:id', async (c) => {
  const b = await body(c, plannedPatch);
  const { db } = tctx(c);
  const id = c.req.param('id');
  const cur = await db.first<{ amount_minor: number }>('SELECT amount_minor FROM planned_expenses WHERE household_id = ?1 AND id = ?2', id);
  if (!cur) throw notFound();
  await db.assertOwned({ accounts: [b.accountId], categories: [b.categoryId], recurring_items: [b.cardRecurringId], transactions: [b.matchedTxId] });
  const dir = b.direction ?? (cur.amount_minor >= 0 ? 'in' : 'out');
  const amt = b.amountMinor !== undefined || b.direction !== undefined ? (dir === 'in' ? 1 : -1) * (b.amountMinor ?? Math.abs(cur.amount_minor)) : null;
  await db.batch([
    db.stmt(
      `UPDATE planned_expenses SET name = COALESCE(?3, name), amount_minor = COALESCE(?4, amount_minor), date = COALESCE(?5, date),
         category_id = CASE WHEN ?6 = 1 THEN ?7 ELSE category_id END, account_id = CASE WHEN ?8 = 1 THEN ?9 ELSE account_id END,
         card_recurring_id = CASE WHEN ?10 = 1 THEN ?11 ELSE card_recurring_id END, status = COALESCE(?12, status),
         matched_tx_id = CASE WHEN ?13 = 1 THEN ?14 ELSE matched_tx_id END, notes = COALESCE(?15, notes)
       WHERE household_id = ?1 AND id = ?2`,
      id,
      b.name ?? null,
      amt,
      b.date ?? null,
      b.categoryId !== undefined ? 1 : 0,
      b.categoryId ?? null,
      b.accountId !== undefined ? 1 : 0,
      b.accountId ?? null,
      b.cardRecurringId !== undefined ? 1 : 0,
      b.cardRecurringId ?? null,
      b.status ?? (b.matchedTxId ? 'done' : null),
      b.matchedTxId !== undefined ? 1 : 0,
      b.matchedTxId ?? null,
      b.notes ?? null,
    ),
    ...(b.matchedTxId ? [db.stmt('UPDATE transactions SET planned_id = ?3 WHERE household_id = ?1 AND id = ?2', b.matchedTxId, id)] : []),
    ...(b.matchedTxId === null ? [db.stmt('UPDATE transactions SET planned_id = NULL WHERE household_id = ?1 AND planned_id = ?2', id)] : []),
  ]);
  return c.json({ ok: true });
});

plannedRoutes.delete('/:id', async (c) => {
  const { db } = tctx(c);
  const id = c.req.param('id');
  if (!(await db.owns('planned_expenses', id))) throw notFound();
  await db.batch([db.stmt('UPDATE transactions SET planned_id = NULL WHERE household_id = ?1 AND planned_id = ?2', id), db.stmt('DELETE FROM planned_expenses WHERE household_id = ?1 AND id = ?2', id)]);
  return c.json({ ok: true });
});

// ---------------- forecast & upcoming ----------------
forecastRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  return c.json(await forecastFor(db, hh, base));
});

upcomingRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ days: z.coerce.number().int().min(1).max(90).optional() }));
  const base = await loadBase(db, hh);
  const end = addDays(base.today, qv.days ?? 45);
  const f = await forecastFor(db, hh, base, end);
  const bal = new Map(f.series.map((s) => [s.date, s.balance]));
  const items = f.events.filter((e) => e.date >= base.today && e.date <= end).map((e) => ({ ...e, balanceAfter: bal.get(e.date) ?? null }));
  return c.json({ today: base.today, end, asOf: f.asOf, stale: f.stale, items, missed: f.missed, overdue: f.overdue, hasForecastAccount: f.hasForecastAccount });
});
