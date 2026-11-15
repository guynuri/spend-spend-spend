import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { addDays, addMonths, dayOf, minDate, monthOf, monthStart } from '../../shared/dates';
import { displayMonth, lastCompleteMonths } from '../../shared/domain/common';
import { buildInsights } from '../../shared/domain/insights';
import { loadBase } from '../db/sql/facts';
import { computeBudget } from '../db/sql/budget';
import { forecastFor } from '../db/sql/forecast';
import { healthBundle } from '../db/sql/health';

export const dashboardRoutes = tenantGroup();

const EXPENSE_LINE = "(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0))";

/** Everything the Overview needs, computed by the same functions as the dedicated pages (AC5.4). */
dashboardRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const base = await loadBase(db, hh);
  const dm = displayMonth(base.today, base.latestTx);
  const cur = monthOf(base.today);
  const [budget, forecast, health] = await Promise.all([computeBudget(db, base, dm.month, 1), forecastFor(db, hh, base), healthBundle(db, base, dm.month, 6)]);
  const paceDay = monthOf(base.asOf) === cur ? dayOf(minDate(base.asOf, base.today)) : null;
  const prevM = addMonths(cur, -1);
  const [extra] = await db.batch([
    db.stmt(
      `SELECT (SELECT COUNT(*) FROM transactions WHERE household_id = ?1 AND category_id IS NULL AND has_splits = 0 AND date >= ?2) AS uncategorized,
              (SELECT COUNT(*) FROM recurring_items WHERE household_id = ?1 AND status = 'suggested') AS suggested,
              (SELECT COUNT(*) FROM accounts WHERE household_id = ?1) AS accounts,
              (SELECT COALESCE(-SUM(l.amount_minor), 0) FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
                 WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?3 AND l.date <= ?4) AS pace_this,
              (SELECT COALESCE(-SUM(l.amount_minor), 0) FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
                 WHERE l.household_id = ?1 AND ${EXPENSE_LINE} AND l.date >= ?5 AND l.date <= ?6) AS pace_prev`,
      addDays(base.today, -60),
      monthStart(cur),
      `${cur}-${String(paceDay ?? 1).padStart(2, '0')}`,
      monthStart(prevM),
      `${prevM}-${String(Math.min(paceDay ?? 1, 28)).padStart(2, '0')}`,
    ),
  ]);
  const x = extra!.results[0] as { uncategorized: number; suggested: number; accounts: number; pace_this: number; pace_prev: number };
  const actual = health.pnl.get(dm.month) ?? { income: 0, expenses: 0 };
  const isCurrent = dm.month === cur;
  const lc = lastCompleteMonths(base.complete, 1)[0];
  const lcHealth = health.months.find((m) => m.month === lc);
  const lcPnl = lc ? health.pnl.get(lc) : undefined;
  const upcoming = forecast.events.filter((e) => e.date >= base.today).slice(0, 5);
  const insights = buildInsights({
    stale: base.hasData && base.stale,
    asOf: base.asOf,
    hasForecastAccount: forecast.hasForecastAccount || x.accounts === 0,
    low: forecast.low,
    belowBuffer: forecast.belowBuffer,
    safetyBuffer: hh.safety_buffer_minor,
    uncategorized60: x.uncategorized,
    month: dm.month,
    isCurrentMonth: isCurrent,
    f: budget.f,
    unsplitCardMinor: budget.unsplitCardMinor,
    lines: budget.lines,
    pace: paceDay ? { thisMinor: x.pace_this, prevMinor: x.pace_prev, day: paceDay } : null,
    suggestedCount: x.suggested,
    bigPayments: forecast.events.filter((e) => e.date >= base.today && e.date <= addDays(base.today, 7) && e.amountMinor < 0).map((e) => ({ label: e.label, date: e.date, amountMinor: e.amountMinor })),
    goals: health.goals,
    lastComplete: lc && lcPnl ? { month: lc, savingsRate: lcPnl.income > 0 ? (lcPnl.income - lcPnl.expenses) / lcPnl.income : null, budgeted: lcHealth?.input.budget.budgetedMinor ?? 0, spentBudgeted: lcHealth?.input.budget.spentMinor ?? 0 } : null,
  });
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
  });
});
