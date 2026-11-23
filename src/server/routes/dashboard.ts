import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { displayMonth, lastCompleteMonths } from '../../shared/domain/common';
import { usualMonth } from '../../shared/domain/usual';
import { generalName, type BudgetMode } from '../../shared/domain/budget';
import { loadBase, pnlByMonthStmt, spentByCategoryStmt, toPnlMap, toSpentMaps } from '../db/sql/facts';
import type { TenantDb } from '../db/tenant';
import type { BaseFacts } from '../db/sql/facts';
import { computeBudget } from '../db/sql/budget';
import { forecastFor } from '../db/sql/forecast';
import { healthBundle } from '../db/sql/health';
import { computeInsights } from '../db/sql/insights';
import { weekRecapFor } from '../db/sql/week';

export const dashboardRoutes = tenantGroup();


/** Everything the Overview needs, computed by the same functions as the dedicated pages (AC5.4). */
dashboardRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const dm = displayMonth(base.today, base.latestTx, base.cal);
  const cur = base.cal.of(base.today);
  const [budget, forecast, health, usual] = await Promise.all([computeBudget(db, base, dm.month, 1), forecastFor(db, hh, base), healthBundle(db, base, dm.month, 6), usualFor(db, base, dm.month)]);
  const { insights, actual, x } = await computeInsights(db, hh, base, dm.month, budget, forecast, health);
  const isCurrent = dm.month === cur;
  const upcoming = forecast.events.filter((e) => e.date >= base.today).slice(0, 5);
  const { series: _series, ...fc } = forecast;
  return c.json({
    month: dm.month,
    period: { start: base.cal.start(dm.month), end: base.cal.end(dm.month), startDay: base.cal.day },
    isLatestData: dm.isLatestData,
    today: base.today,
    asOf: base.asOf,
    stale: base.stale,
    onboarding: !base.hasData && x.accounts === 0,
    hasSampleData: hh.has_sample_data === 1,
    pnl: {
      incomeMinor: actual.income,
      expensesMinor: actual.expenses,
      netMinor: actual.income - actual.expenses,
      expectedIncomeMinor: isCurrent ? actual.income + forecast.monthEvents.positive : null,
      expectedExpensesMinor: isCurrent ? actual.expenses + forecast.monthEvents.negative + forecast.monthEvents.variable : null,
    },
    forecast: { ...fc, series: forecast.series },
    budget: { month: budget.month, f: budget.f, totals: budget.totals, over: budget.lines.filter((l) => l.status === 'over').map((l) => ({ categoryId: l.categoryId, name: l.name, overMinor: -(l.remainingMinor ?? 0) })), unsplitCardMinor: budget.unsplitCardMinor },
    upcoming,
    goals: { summary: health.goalsSummary, items: health.goals.filter((g) => !g.archived && g.status !== 'completed').slice(0, 3) },
    health: { overall: health.current.result.overall, label: health.current.result.label, change: health.change, subs: health.current.result.subs, trend: health.months.map((m) => ({ month: m.month, overall: m.result.overall })) },
    insights: insights.slice(0, 8),
    usual,
  });
});

/**
 * Who paid this period (D-R28): spending per household member. A line counts for its account's owner;
 * on a shared account, a row someone added by hand (or Apple Pay) counts for them; everything else, and
 * anyone no longer a member, is "shared". Transfers and income are left out, like everywhere else.
 */
dashboardRoutes.get('/who', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const month = displayMonth(base.today, base.latestTx, base.cal).month;
  const [rows, members] = await db.batch([
    db.stmt(
      `SELECT m.user_id AS uid, -SUM(l.amount_minor) AS spent
         FROM v_lines l
         JOIN transactions t ON t.id = l.tx_id AND t.household_id = ?1
         JOIN accounts a ON a.id = l.account_id AND a.household_id = ?1
         LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
         LEFT JOIN memberships m ON m.household_id = ?1 AND m.user_id = COALESCE(a.owner_user_id, CASE WHEN t.source = 'manual' THEN t.created_by END)
        WHERE l.household_id = ?1 AND (c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0)) AND l.date >= ?2 AND l.date <= ?3
        GROUP BY m.user_id`,
      base.cal.start(month),
      base.cal.end(month),
    ),
    db.stmt('SELECT u.id, u.display_name AS name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.household_id = ?1 ORDER BY m.created_at'),
  ]);
  const spent = new Map((rows!.results as { uid: string | null; spent: number }[]).map((r) => [r.uid, r.spent]));
  const people = (members!.results as { id: string; name: string }[]).map((u) => ({ userId: u.id, name: u.name, spentMinor: spent.get(u.id) ?? 0 }));
  return c.json({ month, members: people, sharedMinor: spent.get(null) ?? 0, totalMinor: [...spent.values()].reduce((a, b) => a + b, 0) });
});

/** The weekly recap (the 7 days before today) for the in-app card. */
dashboardRoutes.get('/week', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  return c.json(await weekRecapFor(db, base));
});

/** "A usual month" over the up-to-6 complete months before the shown month, and that month so far. */
async function usualFor(db: TenantDb, base: BaseFacts, month: string) {
  const months = lastCompleteMonths(base.complete, 6, month);
  if (!months.length) return null;
  // occasional spending (trips, gifts) is averaged over up to a year
  const occasionalMonths = lastCompleteMonths(base.complete, 12, month);
  const [pnl, spent, now, cats] = await db.batch([
    pnlByMonthStmt(db, base.cal, months[0]!, months[months.length - 1]!),
    spentByCategoryStmt(db, base.cal, occasionalMonths[0]!, months[months.length - 1]!),
    spentByCategoryStmt(db, base.cal, month, month),
    db.stmt('SELECT id, name, system_key, budget_mode FROM categories WHERE household_id = ?1'),
  ]);
  const thisMonth = new Map<string, number>();
  for (const [cid, mm] of toSpentMaps(now)) thisMonth.set(cid, mm.get(month) ?? 0);
  const categories = new Map(
    ((cats?.results ?? []) as { id: string; name: string; system_key: string | null; budget_mode: BudgetMode }[]).map((c) => [c.id, { name: c.name, system: !!c.system_key, mode: c.budget_mode }]),
  );
  return usualMonth({ months, occasionalMonths, pnl: toPnlMap(pnl), spent: toSpentMaps(spent), thisMonth, categories, generalName: generalName(base.locale) });
}
