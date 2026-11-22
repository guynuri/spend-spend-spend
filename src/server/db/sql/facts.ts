/** Shared SQL aggregates (all computed in D1, never by looping rows in the Worker). */
import { addMonths, type MonthStr } from '../../../shared/dates';
import { makeCal, type Cal } from '../../../shared/period';
import { asOfDate, completeMonths, isStale } from '../../../shared/domain/common';
import type { TenantDb } from '../tenant';
import type { HouseholdRow } from '../rows';
import { householdToday } from '../../lib/today';

export interface BaseFacts {
  today: string;
  asOf: string;
  stale: boolean;
  monthsWithTx: MonthStr[];
  complete: MonthStr[];
  latestTx: string | null;
  hasForecastAccount: boolean;
  hasData: boolean;
  /** Household language (default category names, the general-expenses line). */
  locale: string;
  /** Budget periods (pay day, D-R23): every "month" in the money math is one of these. */
  cal: Cal;
  /** Periods for statistics (Trends): `cal`, or calendar months when the household chose them. */
  statsCal: Cal;
}

/** The household's budget periods and statistics periods. */
export const householdCals = (hh: Pick<HouseholdRow, 'period_start_day' | 'stats_by_period'>) => {
  const cal = makeCal(hh.period_start_day ?? 1);
  return { cal, statsCal: hh.stats_by_period === 0 ? makeCal(1) : cal };
};

export async function loadBase(q: TenantDb, hh: HouseholdRow, now = new Date()): Promise<BaseFacts> {
  const today = householdToday(hh, now);
  const { cal, statsCal } = householdCals(hh);
  const [snap, imp, months, latest, fa] = await q.batch([
    q.stmt(
      `SELECT MAX(b.date) AS d FROM account_balances b JOIN accounts a ON a.id = b.account_id AND a.household_id = ?1
        WHERE b.household_id = ?1 AND a.include_in_forecast = 1 AND a.archived = 0`,
    ),
    q.stmt(
      `SELECT MAX(t.date) AS d FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.household_id = ?1
        WHERE t.household_id = ?1 AND (t.source = 'import' OR t.merged_import_id IS NOT NULL) AND a.include_in_forecast = 1 AND a.archived = 0`,
    ),
    q.stmt(`SELECT DISTINCT ${cal.sql('date')} AS m FROM transactions WHERE household_id = ?1 AND date <= ?2 ORDER BY m`, today),
    q.stmt('SELECT MAX(date) AS d FROM transactions WHERE household_id = ?1 AND date <= ?2', today),
    q.stmt('SELECT COUNT(*) AS n FROM accounts WHERE household_id = ?1 AND include_in_forecast = 1 AND archived = 0'),
  ]);
  const d = (r: D1Result | undefined) => ((r?.results[0] as { d: string | null } | undefined)?.d ?? null);
  const asOf = asOfDate(today, d(snap), d(imp));
  const monthsWithTx = (months!.results as { m: string }[]).map((r) => r.m);
  return {
    today,
    asOf,
    stale: isStale(today, asOf),
    monthsWithTx,
    complete: completeMonths(monthsWithTx, asOf, cal),
    latestTx: d(latest),
    hasForecastAccount: ((fa!.results[0] as { n: number }).n ?? 0) > 0,
    hasData: monthsWithTx.length > 0,
    locale: hh.locale,
    cal,
    statsCal,
  };
}

/** Income / Expenses per month (PLAN §10.1): transfers ignored, uncategorized by sign. */
export const PNL_SELECT = `SUM(CASE WHEN c.kind = 'income' OR (l.category_id IS NULL AND l.amount_minor > 0) THEN l.amount_minor ELSE 0 END) AS income,
  -SUM(CASE WHEN c.kind = 'expense' OR (l.category_id IS NULL AND l.amount_minor < 0) THEN l.amount_minor ELSE 0 END) AS expenses`;

/** Per period of `cal`; `fromDate` / `toDate` clip the edge periods (defaults: whole periods). */
export function pnlByMonthStmt(q: TenantDb, cal: Cal, fromMonth: MonthStr, toMonth: MonthStr, fromDate = cal.start(fromMonth), toDate = cal.end(toMonth)) {
  return q.stmt(
    `SELECT ${cal.sql('l.date')} AS m, ${PNL_SELECT}
       FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND l.date >= ?2 AND l.date <= ?3 GROUP BY m`,
    fromDate,
    toDate,
  );
}
export const toPnlMap = (r: D1Result | undefined) => new Map(((r?.results ?? []) as { m: string; income: number; expenses: number }[]).map((x) => [x.m, { income: x.income ?? 0, expenses: x.expenses ?? 0 }]));

/** Spent per (period, expense category) over a range of periods. */
export function spentByCategoryStmt(q: TenantDb, cal: Cal, fromMonth: MonthStr, toMonth: MonthStr) {
  return q.stmt(
    `SELECT ${cal.sql('l.date')} AS m, l.category_id AS cid, -SUM(l.amount_minor) AS spent
       FROM v_lines l JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND c.kind = 'expense' AND l.date >= ?2 AND l.date <= ?3 GROUP BY m, cid`,
    cal.start(fromMonth),
    cal.end(toMonth),
  );
}
export function toSpentMaps(r: D1Result | undefined) {
  const byCat = new Map<string, Map<string, number>>();
  for (const x of (r?.results ?? []) as { m: string; cid: string; spent: number }[]) {
    const mm = byCat.get(x.cid) ?? new Map<string, number>();
    mm.set(x.m, x.spent);
    byCat.set(x.cid, mm);
  }
  return byCat;
}

/**
 * Card charges still waiting to be split: not split, and still uncategorized or on the "card (not
 * split)" placeholder. A charge the user put in one real category as a whole is done. A charge linked
 * to a card account counts with its part no purchase explains yet ("not itemized", D-R20).
 */
export function unsplitCardStmt(q: TenantDb, cal: Cal, month: MonthStr) {
  return q.stmt(
    `SELECT COALESCE(-SUM(l.amount_minor), 0) AS s, COUNT(DISTINCT l.tx_id) AS n FROM v_lines l
       LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND l.kind = 'card_lump' AND l.amount_minor < 0 AND l.date >= ?2 AND l.date <= ?3
        AND ((l.split_id IS NULL AND (l.category_id IS NULL OR c.system_key = 'card_unsplit'))
          OR (l.split_id IS NOT NULL AND c.system_key = 'card_unsplit'
              AND EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = ?1 AND t.id = l.tx_id AND t.card_account_id IS NOT NULL AND t.card_account_id <> 'none')))`,
    cal.start(month),
    cal.end(month),
  );
}

/** Spending in occasional categories per month (expense lines, refunds included). */
export function occasionalByMonthStmt(q: TenantDb, cal: Cal, fromMonth: MonthStr, toMonth: MonthStr, fromDate = cal.start(fromMonth), toDate = cal.end(toMonth)) {
  return q.stmt(
    `SELECT ${cal.sql('l.date')} AS m, -SUM(l.amount_minor) AS spent
       FROM v_lines l JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
      WHERE l.household_id = ?1 AND c.kind = 'expense' AND c.budget_mode = 'occasional' AND l.date >= ?2 AND l.date <= ?3 GROUP BY m`,
    fromDate,
    toDate,
  );
}
export const toMonthMap = (r: D1Result | undefined) => new Map(((r?.results ?? []) as { m: string; spent: number }[]).map((x) => [x.m, x.spent ?? 0]));

/** SQL condition: the line is not in an occasional category (`c` = the line's category, LEFT JOINed). */
export const NOT_OCCASIONAL = "(c.budget_mode IS NULL OR c.budget_mode <> 'occasional')";

export const monthsBack = (m: MonthStr, n: number) => addMonths(m, -n);
