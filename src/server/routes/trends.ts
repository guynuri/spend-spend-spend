import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { query } from '../http';
import { dateStr, id, monthStr } from '../../shared/schemas/common';
import { addDays, addMonths, dayOfWeek, daysBetween, MAX_RANGE_DAYS, monthDiff, monthEnd, monthOf, monthRange, monthStart } from '../../shared/dates';
import { displayMonth } from '../../shared/domain/common';
import { loadBase, pnlByMonthStmt, toPnlMap } from '../db/sql/facts';

export const trendRoutes = tenantGroup();
const EXPENSE_LINE = "(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0))";

/** `from`+`to` (inclusive, < MAX_RANGE_DAYS) or a `month`; defaults to the display month. */
const rangeQ = z
  .object({ month: monthStr.optional(), from: dateStr.optional(), to: dateStr.optional(), compare: z.enum(['prev', 'yoy']).default('prev') })
  .refine((q) => !q.from === !q.to && (!q.from || (q.from <= q.to! && daysBetween(q.from, q.to!) < MAX_RANGE_DAYS)), { message: 'invalid range', path: ['from'] });
async function resolveRange(c: Parameters<typeof tctx>[0]) {
  const { db, hh } = tctx(c);
  const qv = query(c, rangeQ);
  const base = await loadBase(db, hh);
  if (qv.from && qv.to) return { db, base, compare: qv.compare, from: qv.from, to: qv.to };
  const month = qv.month ?? displayMonth(base.today, base.latestTx).month;
  return { db, base, compare: qv.compare, from: monthStart(month), to: monthEnd(month) };
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
 * Spending per bucket over [from, to] plus cumulative vs a previous period: whole-month ranges
 * compare with the same months shifted back by their month count (`compare=yoy`: the same months
 * a year earlier), other ranges with the same number of days just before.
 * Buckets: day ≤ 35 days, Sunday-start week ≤ 190 days, else month; clipped edge buckets are `partial`.
 */
trendRoutes.get('/daily', async (c) => {
  const { db, base, compare, from, to } = await resolveRange(c);
  const span = daysBetween(from, to) + 1;
  const granularity = span <= 35 ? 'day' : span <= 190 ? 'week' : 'month';
  const [fm, tm] = [monthOf(from), monthOf(to)];
  const wholeMonths = from === monthStart(fm) && to === monthEnd(tm);
  const shift = compare === 'yoy' ? 12 : monthDiff(fm, tm) + 1;
  const [pFrom, pTo] = wholeMonths ? [monthStart(addMonths(fm, -shift)), monthEnd(addMonths(tm, -shift))] : [addDays(from, -span), addDays(from, -1)];
  // weeks: both periods use the current period's weekday offset so bucket i lines up
  const off = dayOfWeek(from);
  // nominal bucket i of a period starting at `start`: [first, last] day
  const bucket = (start: string, i: number): [string, string] => {
    if (granularity === 'day') return [addDays(start, i), addDays(start, i)];
    if (granularity === 'week') {
      const s = addDays(start, 7 * i - off);
      return [s, addDays(s, 6)];
    }
    const m = addMonths(monthOf(start), i);
    return [monthStart(m), monthEnd(m)];
  };
  const idx = (d: string, start: string) => (granularity === 'day' ? daysBetween(start, d) : granularity === 'week' ? Math.floor((daysBetween(start, d) + off) / 7) : monthDiff(monthOf(start), monthOf(d)));
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
    else if (r.d <= pTo) prev[idx(r.d, pFrom)]! += r.spent;
  }
  // the current period's cumulative line stops at today
  const last = base.today < from ? -1 : base.today > to ? cur.length - 1 : idx(base.today, from);
  let cum = 0;
  let pcum = 0;
  const points = [];
  for (let i = 0; i < cur.length; i++) {
    cum += cur[i]!;
    // a longer previous period (31 vs 30 days) folds its tail into the last point
    pcum += i === cur.length - 1 ? prev.slice(i).reduce((a, b) => a + b, 0) : (prev[i] ?? 0);
    const [s, e] = bucket(from, i);
    points.push({ start: s < from ? from : s, partial: s < from || e > to, spentMinor: cur[i]!, cumulativeMinor: i <= last ? cum : null, prevCumulativeMinor: pcum });
  }
  return c.json({ from, to, prevFrom: pFrom, prevTo: pTo, granularity, points });
});

/** Income / spending / left over per month over exactly [from, to]; clipped edge months are `partial`. */
trendRoutes.get('/monthly', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, rangeQ.and(z.object({ months: z.coerce.number().int().min(2).max(24).optional(), category: id.optional() })));
  const base = await loadBase(db, hh);
  const toM = qv.to ? monthOf(qv.to) : base.today.slice(0, 7);
  const fromM = qv.from ? monthOf(qv.from) : addMonths(toM, -((qv.months ?? 12) - 1));
  const [from, to] = [qv.from ?? monthStart(fromM), qv.to ?? monthEnd(toM)];
  const months = monthRange(fromM, toM).map((m) => ({ month: m, partial: from > monthStart(m) || to < monthEnd(m) }));
  if (qv.category) {
    const rows = await db.all<{ m: string; spent: number }>(
      `SELECT substr(l.date, 1, 7) AS m, -SUM(l.amount_minor) AS spent FROM v_lines l
        WHERE l.household_id = ?1 AND l.category_id = ?2 AND l.date >= ?3 AND l.date <= ?4 GROUP BY m`,
      qv.category,
      from,
      to,
    );
    const mm = new Map(rows.map((r) => [r.m, r.spent]));
    return c.json({ categoryId: qv.category, points: months.map((p) => ({ ...p, spentMinor: mm.get(p.month) ?? 0 })) });
  }
  const [res] = await db.batch([pnlByMonthStmt(db, fromM, toM, from, to)]);
  const pnl = toPnlMap(res);
  return c.json({ points: months.map((p) => ({ ...p, incomeMinor: pnl.get(p.month)?.income ?? 0, expensesMinor: pnl.get(p.month)?.expenses ?? 0, netMinor: (pnl.get(p.month)?.income ?? 0) - (pnl.get(p.month)?.expenses ?? 0) })) });
});
