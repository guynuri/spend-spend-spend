import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { query } from '../http';
import { id, monthStr } from '../../shared/schemas/common';
import { addMonths, daysInMonth, monthEnd, monthRange, monthStart } from '../../shared/dates';
import { displayMonth } from '../../shared/domain/common';
import { loadBase, pnlByMonthStmt, toPnlMap } from '../db/sql/facts';

export const trendRoutes = tenantGroup();
const EXPENSE_LINE = "(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0))";

trendRoutes.get('/categories', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ month: monthStr.optional() }));
  const base = await loadBase(db, hh);
  const month = qv.month ?? displayMonth(base.today, base.latestTx).month;
  const rows = await db.all<{ cid: string | null; spent: number }>(
    `SELECT l.category_id AS cid, -SUM(l.amount_minor) AS spent FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?2 AND l.date <= ?3 GROUP BY l.category_id ORDER BY spent DESC`,
    monthStart(month),
    monthEnd(month),
  );
  const total = rows.reduce((a, r) => a + r.spent, 0);
  return c.json({ month, totalMinor: total, items: rows.filter((r) => r.spent !== 0).map((r) => ({ categoryId: r.cid, spentMinor: r.spent, share: total > 0 ? r.spent / total : 0 })) });
});

trendRoutes.get('/daily', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ month: monthStr.optional() }));
  const base = await loadBase(db, hh);
  const month = qv.month ?? displayMonth(base.today, base.latestTx).month;
  const prev = addMonths(month, -1);
  const rows = await db.all<{ d: string; spent: number }>(
    `SELECT l.date AS d, -SUM(l.amount_minor) AS spent FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?2 AND l.date <= ?3 GROUP BY l.date`,
    monthStart(prev),
    monthEnd(month),
  );
  const byDate = new Map(rows.map((r) => [r.d, r.spent]));
  const n = Math.max(daysInMonth(month), daysInMonth(prev));
  let cum = 0;
  let pcum = 0;
  const lastDay = month === base.today.slice(0, 7) ? Number(base.today.slice(8)) : daysInMonth(month);
  const days = [];
  for (let d = 1; d <= n; d++) {
    const dd = String(d).padStart(2, '0');
    const s = d <= daysInMonth(month) ? (byDate.get(`${month}-${dd}`) ?? 0) : null;
    const p = d <= daysInMonth(prev) ? (byDate.get(`${prev}-${dd}`) ?? 0) : 0;
    if (s !== null) cum += s;
    pcum += p;
    days.push({ day: d, spentMinor: s ?? 0, cumulativeMinor: s !== null && d <= lastDay ? cum : null, prevCumulativeMinor: pcum });
  }
  return c.json({ month, prevMonth: prev, days });
});

trendRoutes.get('/monthly', async (c) => {
  const { db, hh } = tctx(c);
  const qv = query(c, z.object({ months: z.coerce.number().int().min(2).max(24).optional(), category: id.optional() }));
  const base = await loadBase(db, hh);
  const to = base.today.slice(0, 7);
  const n = qv.months ?? 12;
  const from = addMonths(to, -(n - 1));
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

