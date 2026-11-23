import { addMonths, type MonthStr } from '../../../shared/dates';
import { buildReview, type ReviewSnapshot } from '../../../shared/domain/review';
import type { TenantDb } from '../tenant';
import type { HouseholdRow } from '../rows';
import { loadBase, occasionalByMonthStmt, toMonthMap, type BaseFacts } from './facts';
import { GENERAL_ID, generalName } from '../../../shared/domain/budget';
import type { CatAmount, Notable } from '../../../shared/domain/review';
import { computeBudget } from './budget';
import { forecastFor } from './forecast';
import { healthBundle } from './health';
import { computeInsights } from './insights';

/** Default review month: newest available month (ended + data-complete), else the previous calendar month. Never the running month. */
export function defaultReviewMonth(base: BaseFacts): MonthStr {
  return availableReviewMonths(base)[0] ?? addMonths(base.cal.of(base.today), -1);
}

/**
 * Months whose review is available, newest first: data-complete months (see completeMonths) whose budget
 * period has ended. Computed on read, so a review appears automatically once a month ends — no cron.
 */
export const availableReviewMonths = (base: BaseFacts): MonthStr[] => base.complete.filter((m) => m < base.cal.of(base.today)).reverse();

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
  const [byCat, txs, occ] = await q.batch([
    q.stmt(
      `SELECT ${base.cal.sql('l.date')} AS m, l.category_id AS cid, c.name AS name, c.budget_mode AS mode,
              CASE WHEN c.kind = 'income' OR (l.category_id IS NULL AND l.amount_minor > 0) THEN 'income' ELSE 'expense' END AS side,
              SUM(l.amount_minor) AS amt
         FROM v_lines l LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND l.date >= ?2 AND l.date <= ?3 AND (c.kind IS NULL OR c.kind <> 'transfer')
        GROUP BY m, cid, side`,
      base.cal.start(month),
      base.cal.end(month),
    ),
    // Expense lines, not transactions: a split card charge shows as what it bought. An unsplit card charge
    // (uncategorized or on the "not split" placeholder) is not a purchase and is left out.
    q.stmt(
      `SELECT l.date, CASE WHEN l.split_id IS NULL THEN t.description ELSE COALESCE(s.note, '') END AS description,
              CASE WHEN l.split_id IS NULL THEN NULL ELSE t.description END AS via, l.amount_minor AS amountMinor, c.name AS category
         FROM v_lines l JOIN transactions t ON t.id = l.tx_id AND t.household_id = ?1
         LEFT JOIN transaction_splits s ON s.id = l.split_id AND s.household_id = ?1
         LEFT JOIN categories c ON c.id = l.category_id AND c.household_id = ?1
        WHERE l.household_id = ?1 AND l.date >= ?2 AND l.date <= ?3 AND l.amount_minor < 0 AND (c.kind IS NULL OR c.kind <> 'transfer')
          AND NOT (l.kind = 'card_lump' AND (COALESCE(c.system_key, '') = 'card_unsplit' OR (l.split_id IS NULL AND c.id IS NULL)))`,
      base.cal.start(month),
      base.cal.end(month),
    ),
    occasionalByMonthStmt(q, base.cal, prev, month),
  ]);
  const rows = byCat!.results as { cid: string | null; name: string | null; mode: string | null; side: string; amt: number }[];
  const occMap = toMonthMap(occ);
  // general expenses are reported as one line, with their categories inside
  const expenseRows = rows.filter((r) => r.side === 'expense');
  const generalRows = expenseRows.filter((r) => r.mode === 'general' && r.cid);
  const spendingByCategory: Omit<CatAmount, 'share'>[] = expenseRows
    .filter((r) => !(r.mode === 'general' && r.cid))
    .map((r) => ({ categoryId: r.cid, name: r.name, amountMinor: -r.amt, ...(r.mode === 'occasional' ? { occasional: true } : {}) }));
  if (generalRows.length)
    spendingByCategory.push({
      categoryId: GENERAL_ID,
      name: generalName(base.locale),
      amountMinor: -generalRows.reduce((a, r) => a + r.amt, 0),
      members: generalRows.map((r) => ({ categoryId: r.cid!, name: r.name ?? '', amountMinor: -r.amt })).filter((x) => x.amountMinor !== 0).sort((a, b) => b.amountMinor - a.amountMinor),
    });
  const notable = (txs!.results as unknown as (Notable & { via: string | null })[]).map(({ via, ...n }) => (via === null ? n : { ...n, via }));
  const p = health.pnl;
  const cur = health.months[health.months.length - 1]!;
  const lastComplete = defaultReviewMonth(base);
  return buildReview({
    month,
    cal: base.cal,
    isLatestMonth: month >= lastComplete,
    health: { score: cur.result.overall, label: cur.result.label, change: health.change, recommendations: health.recommendations },
    income: { totalMinor: p.get(month)?.income ?? 0, prevMinor: p.get(prev)?.income ?? 0, byCategory: rows.filter((r) => r.side === 'income').map((r) => ({ categoryId: r.cid, name: r.name, amountMinor: r.amt })) },
    spending: {
      totalMinor: p.get(month)?.expenses ?? 0,
      prevMinor: p.get(prev)?.expenses ?? 0,
      byCategory: spendingByCategory,
      transactions: notable,
      occasionalMinor: occMap.get(month) ?? 0,
      prevOccasionalMinor: occMap.get(prev) ?? 0,
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
