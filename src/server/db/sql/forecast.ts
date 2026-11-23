import { addDays, addMonths } from '../../../shared/dates';
import { lastCompleteMonths } from '../../../shared/domain/common';
import { computeForecast, type ActualIn, type ForecastView, type PlannedIn } from '../../../shared/domain/forecast';
import type { TenantDb } from '../tenant';
import type { HouseholdRow } from '../rows';
import { balancesAt } from './balances';
import { NOT_OCCASIONAL, type BaseFacts } from './facts';
import { parseRecurring, recurringStmts } from './recurringData';

/** Everyday variable spending for the daily baseline; occasional spending (trips, gifts) belongs in planned expenses. */
const EXPENSE_LINE = `(c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0)) AND ${NOT_OCCASIONAL}`;

/** Loads every forecast input with a handful of queries and runs the pure engine (PLAN §10.3). */
export async function forecastFor(q: TenantDb, hh: HouseholdRow, base: BaseFacts, horizonEnd?: string): Promise<ForecastView> {
  const A = base.asOf;
  const { cal } = base;
  const months = lastCompleteMonths(base.complete, 3);
  // to the end of the next budget period
  const H = horizonEnd ?? cal.end(addMonths(cal.of(base.today), 1));
  const res = await q.batch([
    q.stmt('SELECT id FROM accounts WHERE household_id = ?1 AND include_in_forecast = 1 AND archived = 0'),
    ...recurringStmts(q, addDays(A, -400)),
    q.stmt("SELECT id, name, amount_minor, date, account_id, card_recurring_id, status FROM planned_expenses WHERE household_id = ?1 AND status = 'planned'"),
    q.stmt(
      `SELECT t.id, t.date, t.amount_minor, t.account_id, t.recurring_id, t.planned_id, t.source,
              ((c.kind = 'expense' OR (t.category_id IS NULL AND t.has_splits = 0 AND t.amount_minor < 0)) AND ${NOT_OCCASIONAL}) AS is_exp
         FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.household_id = ?1 AND a.include_in_forecast = 1 AND a.archived = 0
         LEFT JOIN categories c ON c.id = t.category_id AND c.household_id = ?1
        WHERE t.household_id = ?1 AND t.date > ?2 AND t.date <= ?3`,
      A,
      H > base.today ? H : base.today,
    ),
    q.stmt(
      `SELECT COALESCE(-SUM(l.amount_minor), 0) AS v FROM v_lines l
         JOIN accounts a ON a.id = l.account_id AND a.household_id = ?1 AND a.include_in_forecast = 1
         LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND ${cal.sql('l.date')} IN (SELECT value FROM json_each(?2)) AND ${EXPENSE_LINE}
          AND l.kind <> 'card_lump' AND l.recurring_id IS NULL AND l.planned_id IS NULL`,
      JSON.stringify(months),
    ),
    q.stmt(
      `SELECT COALESCE(-SUM(l.amount_minor), 0) AS v FROM v_lines l
         JOIN accounts a ON a.id = l.account_id AND a.household_id = ?1 AND a.include_in_forecast = 1
         LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND l.date >= ?2 AND l.date <= ?3 AND ${EXPENSE_LINE}
          AND l.kind <> 'card_lump' AND l.recurring_id IS NULL AND l.planned_id IS NULL`,
      cal.start(cal.of(A)),
      A,
    ),
  ]);
  const fa = (res[0]!.results as { id: string }[]).map((r) => r.id);
  const rec = parseRecurring(res.slice(1, 4));
  const planned = res[4]!.results as unknown as PlannedIn[];
  const actuals: ActualIn[] = (res[5]!.results as { id: string; date: string; amount_minor: number; account_id: string; recurring_id: string | null; planned_id: string | null; source: string; is_exp: number | null }[]).map((r) => ({
    id: r.id,
    date: r.date,
    amount_minor: r.amount_minor,
    account_id: r.account_id,
    recurring_id: r.recurring_id,
    planned_id: r.planned_id,
    isExpense: !!r.is_exp,
    manual: r.source === 'manual',
  }));
  const v = (res[6]!.results[0] as { v: number }).v;
  const vA = (res[7]!.results[0] as { v: number }).v;
  const fas = new Set(fa);
  const bals = fa.length ? await balancesAt(q, A) : [];
  const start = bals.filter((b) => fas.has(b.account_id)).reduce((s, b) => s + b.balance, 0);
  return computeForecast({
    today: base.today,
    asOf: A,
    forecastAccountIds: fa,
    startBalance: start,
    ...rec,
    planned,
    actuals,
    baseline: { setting: hh.forecast_daily_variable_minor, v, d: months.reduce((s, m) => s + cal.days(m), 0), monthOfA: { sum: vA, days: cal.dayIn(A) } },
    completeMonths: base.complete.length,
    safetyBuffer: hh.safety_buffer_minor,
    horizonEnd: H,
    cal,
  });
}
