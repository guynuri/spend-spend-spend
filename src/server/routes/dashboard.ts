import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { monthOf } from '../../shared/dates';
import { displayMonth, lastCompleteMonths } from '../../shared/domain/common';
import { usualMonth } from '../../shared/domain/usual';
import { loadBase, pnlByMonthStmt, spentByCategoryStmt, toPnlMap, toSpentMaps } from '../db/sql/facts';
import type { TenantDb } from '../db/tenant';
import type { BaseFacts } from '../db/sql/facts';
import { computeBudget } from '../db/sql/budget';
import { forecastFor } from '../db/sql/forecast';
import { healthBundle } from '../db/sql/health';
import { computeInsights } from '../db/sql/insights';

export const dashboardRoutes = tenantGroup();


/** Everything the Overview needs, computed by the same functions as the dedicated pages (AC5.4). */
dashboardRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const dm = displayMonth(base.today, base.latestTx);
  const cur = monthOf(base.today);
  const [budget, forecast, health, usual] = await Promise.all([computeBudget(db, base, dm.month, 1), forecastFor(db, hh, base), healthBundle(db, base, dm.month, 6), usualFor(db, base, dm.month)]);
  const { insights, actual, x } = await computeInsights(db, hh, base, dm.month, budget, forecast, health);
  const isCurrent = dm.month === cur;
  const upcoming = forecast.events.filter((e) => e.date >= base.today).slice(0, 5);
  const { series: _series, ...fc } = forecast;
  return c.json({
    month: dm.month,
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

/** "A usual month" over the up-to-6 complete months before the shown month, and that month so far. */
async function usualFor(db: TenantDb, base: BaseFacts, month: string) {
  const months = lastCompleteMonths(base.complete, 6, month);
  if (!months.length) return null;
  const [pnl, spent, now, cats] = await db.batch([
    pnlByMonthStmt(db, months[0]!, months[months.length - 1]!),
    spentByCategoryStmt(db, months[0]!, months[months.length - 1]!),
    spentByCategoryStmt(db, month, month),
    db.stmt('SELECT id, name, system_key FROM categories WHERE household_id = ?1'),
  ]);
  const thisMonth = new Map<string, number>();
  for (const [cid, mm] of toSpentMaps(now)) thisMonth.set(cid, mm.get(month) ?? 0);
  const categories = new Map(((cats?.results ?? []) as { id: string; name: string; system_key: string | null }[]).map((c) => [c.id, { name: c.name, system: !!c.system_key }]));
  return usualMonth({ months, pnl: toPnlMap(pnl), spent: toSpentMaps(spent), thisMonth, categories });
}
