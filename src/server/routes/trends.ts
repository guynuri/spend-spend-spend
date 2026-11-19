import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { query } from '../http';
import { dateStr, id, monthStr } from '../../shared/schemas/common';
import { addDays, addMonths, dayOfWeek, daysBetween, MAX_RANGE_DAYS, monthDiff, monthEnd, monthOf, monthRange, monthStart } from '../../shared/dates';
import { displayMonth } from '../../shared/domain/common';
import { loadBase, occasionalByMonthStmt, pnlByMonthStmt, toMonthMap, toPnlMap } from '../db/sql/facts';
import { GENERAL_ID } from '../../shared/domain/budget';

export const trendRoutes = tenantGroup();
const EXPENSE_LINE = "(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0))";

/** `from`+`to` (inclusive, < MAX_RANGE_DAYS) or a `month`; defaults to the display month. */
const rangeQ = z
  .object({ month: monthStr.optional(), from: dateStr.optional(), to: dateStr.optional(), compare: z.enum(['prev', 'yoy']).default('prev') })
  .refine((q) => !q.from === !q.to && (!q.from || (q.from <= q.to! && daysBetween(q.from, q.to!) < MAX_RANGE_DAYS)), { message: 'invalid range', path: ['from'] })
  // a 12-month shift would overlap a longer range
  .refine((q) => q.compare !== 'yoy' || !q.from || monthDiff(monthOf(q.from), monthOf(q.to!)) < 12, { message: 'yoy needs ≤ 12 months', path: ['compare'] });
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
  const rows = await db.all<{ cid: string | null; mode: string | null; spent: number }>(
    `SELECT l.category_id AS cid, c.budget_mode AS mode, -SUM(l.amount_minor) AS spent FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?2 AND l.date <= ?3 GROUP BY l.category_id ORDER BY spent DESC`,
    from,
    to,
  );
  const total = rows.reduce((a, r) => a + r.spent, 0);
  const share = (x: number) => (total > 0 ? x / total : 0);
  // general expenses come back as one item (GENERAL_ID) with their categories inside
  const general = rows.filter((r) => r.mode === 'general' && r.cid && r.spent !== 0);
  const gSum = general.reduce((a, r) => a + r.spent, 0);
  const items: { categoryId: string | null; spentMinor: number; share: number; occasional?: boolean; members?: { categoryId: string; spentMinor: number; share: number }[] }[] = rows
    .filter((r) => r.spent !== 0 && !(r.mode === 'general' && r.cid))
    .map((r) => ({ categoryId: r.cid, spentMinor: r.spent, share: share(r.spent), ...(r.mode === 'occasional' ? { occasional: true } : {}) }));
  if (general.length) items.push({ categoryId: GENERAL_ID, spentMinor: gSum, share: share(gSum), members: general.map((r) => ({ categoryId: r.cid!, spentMinor: r.spent, share: share(r.spent) })) });
  items.sort((a, b) => b.spentMinor - a.spentMinor);
  return c.json({ from, to, totalMinor: total, items });
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
  // category: a category id, or GENERAL_ID for all general expenses together
  const qv = query(c, rangeQ.and(z.object({ months: z.coerce.number().int().min(2).max(24).optional(), category: id.optional() })));
  const base = await loadBase(db, hh);
  const toM = qv.to ? monthOf(qv.to) : base.today.slice(0, 7);
  const fromM = qv.from ? monthOf(qv.from) : addMonths(toM, -((qv.months ?? 12) - 1));
  const [from, to] = [qv.from ?? monthStart(fromM), qv.to ?? monthEnd(toM)];
  const months = monthRange(fromM, toM).map((m) => ({ month: m, partial: from > monthStart(m) || to < monthEnd(m) }));
  if (qv.category) {
    const rows = await db.all<{ m: string; spent: number }>(
      qv.category === GENERAL_ID
        ? `SELECT substr(l.date, 1, 7) AS m, -SUM(l.amount_minor) AS spent FROM v_lines l JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
            WHERE l.household_id = ?1 AND c.kind = 'expense' AND c.budget_mode = 'general' AND ?2 = ?2 AND l.date >= ?3 AND l.date <= ?4 GROUP BY m`
        : `SELECT substr(l.date, 1, 7) AS m, -SUM(l.amount_minor) AS spent FROM v_lines l
            WHERE l.household_id = ?1 AND l.category_id = ?2 AND l.date >= ?3 AND l.date <= ?4 GROUP BY m`,
      qv.category,
      from,
      to,
    );
    const mm = new Map(rows.map((r) => [r.m, r.spent]));
    return c.json({ categoryId: qv.category, points: months.map((p) => ({ ...p, spentMinor: mm.get(p.month) ?? 0 })) });
  }
  const [res, occ] = await db.batch([pnlByMonthStmt(db, fromM, toM, from, to), occasionalByMonthStmt(db, fromM, toM, from, to)]);
  const pnl = toPnlMap(res);
  const om = toMonthMap(occ);
  return c.json({
    points: months.map((p) => {
      const income = pnl.get(p.month)?.income ?? 0;
      const expenses = pnl.get(p.month)?.expenses ?? 0;
      const occasional = om.get(p.month) ?? 0;
      // expenses = everyday + occasional (vacations, gifts), so the chart can tell a habit from a trip
      return { ...p, incomeMinor: income, expensesMinor: expenses, occasionalMinor: occasional, everydayMinor: expenses - occasional, netMinor: income - expenses };
    }),
  });
});

/**
 * Occasional categories over a year and the year before, by quarter: they come in lumps, so they are
 * compared over quarters and years rather than months.
 */
trendRoutes.get('/occasional', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ year: z.string().regex(/^\d{4}$/).optional() }));
  const base = await loadBase(db, hh);
  const year = qv.year ?? base.today.slice(0, 4);
  const prevYear = String(Number(year) - 1);
  const rows = await db.all<{ cid: string; name: string; archived: number; y: string; q: number; spent: number }>(
    `SELECT c.id AS cid, c.name, c.archived, substr(l.date, 1, 4) AS y, (CAST(substr(l.date, 6, 2) AS INTEGER) + 2) / 3 AS q, -SUM(l.amount_minor) AS spent
       FROM v_lines l JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND c.kind = 'expense' AND c.budget_mode = 'occasional' AND l.date >= ?2 AND l.date <= ?3
      GROUP BY c.id, y, q`,
    `${prevYear}-01-01`,
    `${year}-12-31`,
  );
  const cats = await db.all<{ id: string; name: string }>("SELECT id, name FROM categories WHERE household_id = ?1 AND kind = 'expense' AND budget_mode = 'occasional' AND archived = 0 ORDER BY sort, name");
  const byCat = new Map<string, { categoryId: string; name: string; quarters: number[]; prevQuarters: number[] }>();
  for (const k of cats) byCat.set(k.id, { categoryId: k.id, name: k.name, quarters: [0, 0, 0, 0], prevQuarters: [0, 0, 0, 0] });
  for (const r of rows) {
    const e = byCat.get(r.cid) ?? { categoryId: r.cid, name: r.name, quarters: [0, 0, 0, 0], prevQuarters: [0, 0, 0, 0] };
    (r.y === year ? e.quarters : e.prevQuarters)[r.q - 1]! += r.spent;
    byCat.set(r.cid, e);
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const items = [...byCat.values()].map((e) => ({ ...e, yearMinor: sum(e.quarters), prevYearMinor: sum(e.prevQuarters) })).sort((a, b) => b.yearMinor - a.yearMinor || b.prevYearMinor - a.prevYearMinor);
  const quarters = [0, 1, 2, 3].map((i) => ({ quarter: i + 1, spentMinor: sum(items.map((e) => e.quarters[i]!)), prevSpentMinor: sum(items.map((e) => e.prevQuarters[i]!)) }));
  return c.json({ year, prevYear, today: base.today, items, quarters, yearMinor: sum(items.map((e) => e.yearMinor)), prevYearMinor: sum(items.map((e) => e.prevYearMinor)) });
});
