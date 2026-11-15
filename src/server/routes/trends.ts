import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { badRequest, query } from '../http';
import { dateStr, id, monthStr } from '../../shared/schemas/common';
import { addDays, addMonths, daysBetween, monthDiff, monthEnd, monthOf, monthRange, monthStart } from '../../shared/dates';
import { displayMonth } from '../../shared/domain/common';
import { loadBase, pnlByMonthStmt, toPnlMap } from '../db/sql/facts';

export const trendRoutes = tenantGroup();
const EXPENSE_LINE = "(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0))";

/** `from`+`to` (inclusive, ≤ ~3 years) or a `month`; defaults to the display month. */
const rangeQ = z
  .object({ month: monthStr.optional(), from: dateStr.optional(), to: dateStr.optional() })
  .refine((q) => !q.from === !q.to && (!q.from || (q.from <= q.to! && daysBetween(q.from, q.to!) <= 1100)), { message: 'invalid range', path: ['from'] });
async function resolveRange(c: Parameters<typeof tctx>[0]) {
  const { db, hh } = tctx(c);
  const qv = query(c, rangeQ);
  const base = await loadBase(db, hh);
  if (qv.from && qv.to) return { db, base, from: qv.from, to: qv.to };
  const month = qv.month ?? displayMonth(base.today, base.latestTx).month;
  return { db, base, from: monthStart(month), to: monthEnd(month) };
}

trendRoutes.get('/categories', async (c) => {
  const { db, from, to } = await resolveRange(c);
  const rows = await db.all<{ cid: string | null; spent: number }>(
    `SELECT l.category_id AS cid, -SUM(l.amount_minor) AS spent FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?2 AND l.date <= ?3 GROUP BY l.category_id ORDER BY spent DESC`,
    from,
    to,
  );
  const total = rows.reduce((a, r) => a + r.spent, 0);
  return c.json({ from, to, totalMinor: total, items: rows.filter((r) => r.spent !== 0).map((r) => ({ categoryId: r.cid, spentMinor: r.spent, share: total > 0 ? r.spent / total : 0 })) });
});

/**
 * Spending per bucket over [from, to] plus cumulative vs the previous period of the same shape
 * (previous N whole months, else the same number of days just before). Buckets: day ≤ 35 days,
 * week ≤ 190 days, else month.
 */
trendRoutes.get('/daily', async (c) => {
  const { db, base, from, to } = await resolveRange(c);
  const span = daysBetween(from, to) + 1;
  const granularity = span <= 35 ? 'day' : span <= 190 ? 'week' : 'month';
  const idx = (d: string, start: string) => (granularity === 'day' ? daysBetween(start, d) : granularity === 'week' ? Math.floor(daysBetween(start, d) / 7) : monthDiff(monthOf(start), monthOf(d)));
  const wholeMonths = from === monthStart(monthOf(from)) && to === monthEnd(monthOf(to));
  const pFrom = wholeMonths ? monthStart(addMonths(monthOf(from), -(monthDiff(monthOf(from), monthOf(to)) + 1))) : addDays(from, -span);
  const pTo = addDays(from, -1);
  const rows = await db.all<{ d: string; spent: number }>(
    `SELECT l.date AS d, -SUM(l.amount_minor) AS spent FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?2 AND l.date <= ?3 GROUP BY l.date`,
    pFrom,
    to,
  );
  const cur: number[] = Array(idx(to, from) + 1).fill(0);
  const prev: number[] = Array(idx(pTo, pFrom) + 1).fill(0);
  for (const r of rows) {
    if (r.d >= from) cur[idx(r.d, from)]! += r.spent;
    else prev[idx(r.d, pFrom)]! += r.spent;
  }
  // the current period's cumulative line stops at today
  const last = base.today < from ? -1 : base.today > to ? cur.length - 1 : idx(base.today, from);
  const start = (i: number) => (granularity === 'day' ? addDays(from, i) : granularity === 'week' ? addDays(from, 7 * i) : i === 0 ? from : monthStart(addMonths(monthOf(from), i)));
  let cum = 0;
  let pcum = 0;
  const points = [];
  for (let i = 0; i < cur.length; i++) {
    cum += cur[i]!;
    // a longer previous period (31 vs 30 days) folds its tail into the last point
    pcum += i === cur.length - 1 ? prev.slice(i).reduce((a, b) => a + b, 0) : (prev[i] ?? 0);
    points.push({ start: start(i), spentMinor: cur[i]!, cumulativeMinor: i <= last ? cum : null, prevCumulativeMinor: pcum });
  }
  return c.json({ from, to, prevFrom: pFrom, prevTo: pTo, granularity, points });
});

trendRoutes.get('/monthly', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ months: z.coerce.number().int().min(2).max(24).optional(), category: id.optional(), from: dateStr.optional(), to: dateStr.optional() }));
  const base = await loadBase(db, hh);
  // whole months spanned by [from, to] (≤ 36), else the last `months` (default 12) up to this month
  const ranged = qv.from && qv.to && qv.from <= qv.to && monthDiff(monthOf(qv.from), monthOf(qv.to)) < 36;
  if ((qv.from || qv.to) && !ranged) throw badRequest('validation', [{ path: 'from', code: 'invalid range' }]);
  const to = ranged ? monthOf(qv.to!) : base.today.slice(0, 7);
  const from = ranged ? monthOf(qv.from!) : addMonths(to, -((qv.months ?? 12) - 1));
  const months = monthRange(from, to);
  if (qv.category) {
    const rows = await db.all<{ m: string; spent: number }>(
      `SELECT substr(l.date, 1, 7) AS m, -SUM(l.amount_minor) AS spent FROM v_lines l
        WHERE l.household_id = ?1 AND l.category_id = ?2 AND l.date >= ?3 AND l.date <= ?4 GROUP BY m`,
      qv.category,
      monthStart(from),
      monthEnd(to),
    );
    const mm = new Map(rows.map((r) => [r.m, r.spent]));
    return c.json({ categoryId: qv.category, points: months.map((m) => ({ month: m, spentMinor: mm.get(m) ?? 0 })) });
  }
  const [res] = await db.batch([pnlByMonthStmt(db, from, to)]);
  const pnl = toPnlMap(res);
  return c.json({ points: months.map((m) => ({ month: m, incomeMinor: pnl.get(m)?.income ?? 0, expensesMinor: pnl.get(m)?.expenses ?? 0, netMinor: (pnl.get(m)?.income ?? 0) - (pnl.get(m)?.expenses ?? 0) })) });
});

