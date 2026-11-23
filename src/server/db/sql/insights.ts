import { addDays, addMonths, minDate } from '../../../shared/dates';
import { lastCompleteMonths } from '../../../shared/domain/common';
import { buildInsights } from '../../../shared/domain/insights';
import type { BudgetView } from '../../../shared/domain/budget';
import type { ForecastView } from '../../../shared/domain/forecast';
import type { TenantDb } from '../tenant';
import type { HouseholdRow } from '../rows';
import { NOT_OCCASIONAL, type BaseFacts } from './facts';
import type { HealthBundle } from './health';

/** Pace compares everyday spending: occasional categories (a vacation) would swamp it. */
const EXPENSE_LINE = `(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0)) AND ${NOT_OCCASIONAL}`;

/** Action items for a month (PLAN §10.7) — shared by the dashboard and the monthly review. */
export async function computeInsights(db: TenantDb, hh: HouseholdRow, base: BaseFacts, month: string, budget: BudgetView, forecast: ForecastView, health: HealthBundle) {
  const { cal } = base;
  const cur = cal.of(base.today);
  // pace: the first `paceDay` days of this period vs the same days of the previous one
  const paceDay = month === cur && cal.of(base.asOf) === cur ? cal.dayIn(minDate(base.asOf, base.today)) : null;
  const prevM = addMonths(cur, -1);
  const upTo = (m: string) => minDate(addDays(cal.start(m), (paceDay ?? 1) - 1), cal.end(m));
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
      cal.start(cur),
      upTo(cur),
      cal.start(prevM),
      upTo(prevM),
    ),
  ]);
  const x = extra!.results[0] as { uncategorized: number; suggested: number; accounts: number; pace_this: number; pace_prev: number };
  const actual = health.pnl.get(month) ?? { income: 0, expenses: 0 };
  const isCurrent = month === cur;
  const lc = lastCompleteMonths(base.complete, 1)[0];
  const lcHealth = health.months.find((m) => m.month === lc);
  const lcPnl = lc ? health.pnl.get(lc) : undefined;
  const insights = buildInsights({
    cal,
    stale: base.hasData && base.stale,
    asOf: base.asOf,
    hasForecastAccount: forecast.hasForecastAccount || x.accounts === 0,
    low: forecast.low,
    belowBuffer: forecast.belowBuffer,
    safetyBuffer: hh.safety_buffer_minor,
    uncategorized60: x.uncategorized,
    month: month,
    isCurrentMonth: isCurrent,
    f: budget.f,
    unsplitCardMinor: budget.unsplitCardMinor,
    lines: budget.lines,
    occasional: budget.occasional.lines,
    pace: paceDay ? { thisMinor: x.pace_this, prevMinor: x.pace_prev, day: paceDay } : null,
    suggestedCount: x.suggested,
    bigPayments: forecast.events.filter((e) => e.date >= base.today && e.date <= addDays(base.today, 7) && e.amountMinor < 0).map((e) => ({ label: e.label, date: e.date, amountMinor: e.amountMinor })),
    goals: health.goals,
    lastComplete: lc && lcPnl ? { month: lc, savingsRate: lcPnl.income > 0 ? (lcPnl.income - lcPnl.expenses) / lcPnl.income : null, budgeted: lcHealth?.input.budget.budgetedMinor ?? 0, spentBudgeted: lcHealth?.input.budget.spentMinor ?? 0 } : null,
  });
  return { insights, actual, x };
}
