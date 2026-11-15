import { addMonths, monthEnd, monthOf, monthStart, type MonthStr } from '../../../shared/dates';
import { lastCompleteMonths } from '../../../shared/domain/common';
import { buildReview, type ReviewSnapshot } from '../../../shared/domain/review';
import type { TenantDb } from '../tenant';
import type { HouseholdRow } from '../rows';
import { loadBase, type BaseFacts } from './facts';
import { computeBudget } from './budget';
import { forecastFor } from './forecast';
import { healthBundle } from './health';
import { computeInsights } from './insights';

/** Default review month: last complete month (else the previous calendar month). */
export function defaultReviewMonth(base: BaseFacts): MonthStr {
  return lastCompleteMonths(base.complete, 1)[0] ?? addMonths(monthOf(base.today), -1);
}

/**
 * Months whose review is available, newest first: data-complete months (see completeMonths) whose calendar
 * month has ended. Computed on read, so a review appears automatically once a month ends — no cron.
 */
export const availableReviewMonths = (base: BaseFacts): MonthStr[] => base.complete.filter((m) => m < monthOf(base.today)).reverse();

/** The newest available month whose review is neither completed nor dismissed (nav badge, overview card, alerts); else null. */
export async function reviewDue(q: TenantDb, base: BaseFacts): Promise<MonthStr | null> {
  const m = availableReviewMonths(base)[0];
  if (!m) return null;
  const r = await q.first<{ status: string; dismissed_at: string | null }>('SELECT status, dismissed_at FROM reviews WHERE household_id = ?1 AND month = ?2', m);
  return r && (r.status === 'completed' || r.dismissed_at) ? null : m;
}

/** Builds the language-neutral review snapshot for month M (PLAN §10.8). */
export async function buildReviewFor(q: TenantDb, hh: HouseholdRow, month: MonthStr, baseIn?: BaseFacts): Promise<ReviewSnapshot> {
  const base = baseIn ?? (await loadBase(q, hh));
  const prev = addMonths(month, -1);
  const [budget, forecast, health] = await Promise.all([computeBudget(q, base, month, 1), forecastFor(q, hh, base), healthBundle(q, base, month, 2)]);
  const { insights } = await computeInsights(q, hh, base, month, budget, forecast, health);
  const [byCat, txs] = await q.batch([
    q.stmt(
      `SELECT substr(l.date, 1, 7) AS m, l.category_id AS cid, c.name AS name,
              CASE WHEN c.kind = 'income' OR (l.category_id IS NULL AND l.amount_minor > 0) THEN 'income' ELSE 'expense' END AS side,
              SUM(l.amount_minor) AS amt
         FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND l.date >= ?2 AND l.date <= ?3 AND (c.kind IS NULL OR c.kind <> 'transfer')
        GROUP BY m, cid, side`,
      monthStart(month),
      monthEnd(month),
    ),
    q.stmt(
      `SELECT t.date, t.description, t.amount_minor AS amountMinor, c.name AS category FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id AND c.household_id = ?1
        WHERE t.household_id = ?1 AND t.date >= ?2 AND t.date <= ?3 AND t.amount_minor < 0 AND (c.kind IS NULL OR c.kind <> 'transfer')`,
      monthStart(month),
      monthEnd(month),
    ),
  ]);
  const rows = byCat!.results as { cid: string | null; name: string | null; side: string; amt: number }[];
  const p = health.pnl;
  const cur = health.months[health.months.length - 1]!;
  const lastComplete = defaultReviewMonth(base);
  return buildReview({
    month,
    isLatestMonth: month >= lastComplete,
    health: { score: cur.result.overall, label: cur.result.label, change: health.change, recommendations: health.recommendations },
    income: { totalMinor: p.get(month)?.income ?? 0, prevMinor: p.get(prev)?.income ?? 0, byCategory: rows.filter((r) => r.side === 'income').map((r) => ({ categoryId: r.cid, name: r.name, amountMinor: r.amt })) },
    spending: {
      totalMinor: p.get(month)?.expenses ?? 0,
      prevMinor: p.get(prev)?.expenses ?? 0,
      byCategory: rows.filter((r) => r.side === 'expense').map((r) => ({ categoryId: r.cid, name: r.name, amountMinor: -r.amt })),
      transactions: txs!.results as { date: string; description: string; amountMinor: number; category: string | null }[],
    },
    budget: { budgetedMinor: budget.totals.budgetedMinor, spentBudgetedMinor: budget.totals.spentBudgetedMinor, lines: budget.lines.map((l) => ({ name: l.name, spentMinor: l.spentMinor, limitMinor: l.limitMinor })) },
    goals: {
      activeCount: cur.goals.filter((g) => !g.archived && g.status !== 'completed').length,
      savedMinor: cur.goals.reduce((s, g) => s + g.savedMinor, 0),
      targetMinor: cur.goals.reduce((s, g) => s + g.targetMinor, 0),
      items: cur.goals.filter((g) => !g.archived).map((g) => ({ name: g.name, progress: g.progress, requiredMonthlyMinor: g.requiredMonthlyMinor, status: g.status, milestones: g.milestones })),
    },
    forecast: forecast.eom && forecast.low ? { eomMinor: forecast.eom.balance, lowMinor: forecast.low.balance, lowDate: forecast.low.date } : null,
    upcoming: forecast.events.filter((e) => e.date >= base.today).slice(0, 5).map((e) => ({ date: e.date, label: e.label, amountMinor: e.amountMinor })),
    insights,
  });
}
