/**
 * Monthly review snapshot (PLAN §10.8). Language-neutral: every text is a catalog key + params,
 * rendered on the client, so a review reads in either locale and AI is purely additive.
 */
import type { MonthStr } from '../dates';
import type { Insight } from './insights';
import type { Recommendation, Label } from './health';
import type { GoalStatus } from './goals';

export interface Commentary {
  key: string;
  params: Record<string, string | number>;
}
export interface CatAmount {
  categoryId: string | null;
  name: string | null;
  amountMinor: number;
  share: number;
}
export interface ReviewSnapshot {
  version: 1;
  month: MonthStr;
  isLatestMonth: boolean;
  summary: { score: number | null; label: Label | null; change: number | null; incomeMinor: number; expensesMinor: number; netMinor: number; headlines: Insight[]; chips: ('score_up' | 'milestone' | 'under_budget')[]; commentary: Commentary };
  income: { totalMinor: number; prevMinor: number; changePct: number | null; byCategory: CatAmount[]; commentary: Commentary };
  spending: { totalMinor: number; prevMinor: number; changePct: number | null; budgetedMinor: number; byCategory: CatAmount[]; notable: { date: string; description: string; amountMinor: number; category: string | null }[]; commentary: Commentary };
  budget: { ok: number; total: number; lines: { name: string; spentMinor: number; limitMinor: number; overMinor: number }[]; commentary: Commentary };
  goals: { activeCount: number; savedMinor: number; targetMinor: number; items: { name: string; progress: number; requiredMonthlyMinor: number | null; status: GoalStatus; milestones: number[] }[]; commentary: Commentary };
  cashflow: { savingsRate: number | null; forecast: { eomMinor: number; lowMinor: number; lowDate: string } | null; upcoming: { date: string; label: string; amountMinor: number }[]; commentary: Commentary };
  wrapup: { headline: Commentary; wins: Insight[]; watch: Insight[]; nextSteps: Recommendation[]; commentary: Commentary };
}
export const CHAPTERS = ['summary', 'income', 'spending', 'budget', 'goals', 'cashflow', 'wrapup'] as const;
export type Chapter = (typeof CHAPTERS)[number];

export const trend = (cur: number, prev: number): 'up' | 'down' | 'flat' => {
  if (prev === 0) return cur === 0 ? 'flat' : 'up';
  const d = (cur - prev) / Math.abs(prev);
  return d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
};
const pct = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : null);

export interface ReviewInput {
  month: MonthStr;
  isLatestMonth: boolean;
  health: { score: number | null; label: Label | null; change: number | null; recommendations: Recommendation[] };
  income: { totalMinor: number; prevMinor: number; byCategory: { categoryId: string | null; name: string | null; amountMinor: number }[] };
  spending: { totalMinor: number; prevMinor: number; byCategory: { categoryId: string | null; name: string | null; amountMinor: number }[]; transactions: { date: string; description: string; amountMinor: number; category: string | null }[] };
  budget: { budgetedMinor: number; spentBudgetedMinor: number; lines: { name: string; spentMinor: number; limitMinor: number | null }[] };
  goals: { activeCount: number; savedMinor: number; targetMinor: number; items: { name: string; progress: number; requiredMonthlyMinor: number | null; status: GoalStatus; milestones: { pct: number; date: string }[] }[] };
  forecast: { eomMinor: number; lowMinor: number; lowDate: string } | null;
  upcoming: { date: string; label: string; amountMinor: number }[];
  insights: Insight[];
}

const share = (xs: { categoryId: string | null; name: string | null; amountMinor: number }[]): CatAmount[] => {
  const tot = xs.reduce((a, x) => a + x.amountMinor, 0);
  return xs.filter((x) => x.amountMinor !== 0).sort((a, b) => b.amountMinor - a.amountMinor).map((x) => ({ ...x, share: tot > 0 ? x.amountMinor / tot : 0 }));
};

/** Notable: expense transactions ≥ max(₪500, 3 × the month's median expense), top 5. */
export function notableTransactions<T extends { amountMinor: number }>(txs: T[]): T[] {
  const exp = txs.filter((t) => t.amountMinor < 0).map((t) => -t.amountMinor).sort((a, b) => a - b);
  if (!exp.length) return [];
  const n = exp.length;
  const median = n % 2 ? exp[(n - 1) / 2]! : (exp[n / 2 - 1]! + exp[n / 2]!) / 2;
  const th = Math.max(50000, 3 * median);
  return txs.filter((t) => -t.amountMinor >= th).sort((a, b) => a.amountMinor - b.amountMinor).slice(0, 5);
}

export function buildReview(i: ReviewInput): ReviewSnapshot {
  const net = i.income.totalMinor - i.spending.totalMinor;
  const savingsRate = i.income.totalMinor > 0 ? net / i.income.totalMinor : null;
  const over = i.budget.lines.filter((l) => l.limitMinor !== null && l.spentMinor > l.limitMinor);
  const budgeted = i.budget.lines.filter((l) => l.limitMinor !== null);
  const milestonesThisMonth = i.goals.items.flatMap((g) => g.milestones.filter((m) => m.date.slice(0, 7) === i.month));
  const chips: ReviewSnapshot['summary']['chips'] = [];
  if ((i.health.change ?? 0) >= 3) chips.push('score_up');
  if (milestonesThisMonth.length) chips.push('milestone');
  if (i.budget.budgetedMinor > 0 && i.budget.spentBudgetedMinor <= i.budget.budgetedMinor) chips.push('under_budget');
  const spendTrend = trend(i.spending.totalMinor, i.spending.prevMinor);
  const incTrend = trend(i.income.totalMinor, i.income.prevMinor);
  const behind = i.goals.items.filter((g) => g.status === 'behind');
  const scoreDir = i.health.change === null ? 'flat' : i.health.change >= 3 ? 'up' : i.health.change <= -3 ? 'down' : 'flat';
  const headline: Commentary = i.health.score === null ? { key: 'review.h.no_score', params: { netMinor: net } } : { key: `review.h.${i.health.label}_${scoreDir}`, params: { score: i.health.score } };
  const sev = (s: string) => i.insights.filter((x) => x.severity === s);
  return {
    version: 1,
    month: i.month,
    isLatestMonth: i.isLatestMonth,
    summary: {
      score: i.health.score,
      label: i.health.label,
      change: i.health.change,
      incomeMinor: i.income.totalMinor,
      expensesMinor: i.spending.totalMinor,
      netMinor: net,
      headlines: [...sev('alert'), ...sev('warn'), ...sev('info'), ...sev('good')].slice(0, 4),
      chips,
      commentary: { key: net >= 0 ? 'review.c.summary.positive' : 'review.c.summary.negative', params: { netMinor: Math.abs(net), month: i.month } },
    },
    income: {
      totalMinor: i.income.totalMinor,
      prevMinor: i.income.prevMinor,
      changePct: pct(i.income.totalMinor, i.income.prevMinor),
      byCategory: share(i.income.byCategory),
      commentary: { key: `review.c.income.${incTrend}`, params: { pct: Math.abs(pct(i.income.totalMinor, i.income.prevMinor) ?? 0) } },
    },
    spending: {
      totalMinor: i.spending.totalMinor,
      prevMinor: i.spending.prevMinor,
      changePct: pct(i.spending.totalMinor, i.spending.prevMinor),
      budgetedMinor: i.budget.budgetedMinor,
      byCategory: share(i.spending.byCategory),
      notable: notableTransactions(i.spending.transactions),
      commentary: { key: `review.c.spending.${spendTrend}_${over.length ? 'over' : 'under'}`, params: { pct: Math.abs(pct(i.spending.totalMinor, i.spending.prevMinor) ?? 0), count: over.length } },
    },
    budget: {
      ok: budgeted.length - over.length,
      total: budgeted.length,
      lines: budgeted.map((l) => ({ name: l.name, spentMinor: l.spentMinor, limitMinor: l.limitMinor!, overMinor: Math.max(0, l.spentMinor - l.limitMinor!) })),
      commentary: { key: budgeted.length === 0 ? 'review.c.budget.none' : over.length === 0 ? 'review.c.budget.all_within' : 'review.c.budget.some_over', params: { count: over.length, total: budgeted.length } },
    },
    goals: {
      activeCount: i.goals.activeCount,
      savedMinor: i.goals.savedMinor,
      targetMinor: i.goals.targetMinor,
      items: i.goals.items.map((g) => ({ name: g.name, progress: g.progress, requiredMonthlyMinor: g.requiredMonthlyMinor, status: g.status, milestones: g.milestones.filter((m) => m.date.slice(0, 7) === i.month).map((m) => m.pct) })),
      commentary: { key: i.goals.items.length === 0 ? 'review.c.goals.none' : behind.length ? 'review.c.goals.some_behind' : 'review.c.goals.all_on_track', params: { count: behind.length } },
    },
    cashflow: {
      savingsRate,
      forecast: i.isLatestMonth ? i.forecast : null,
      upcoming: i.upcoming.slice(0, 5),
      commentary: { key: savingsRate === null ? 'review.c.cashflow.no_income' : savingsRate >= 0.2 ? 'review.c.cashflow.strong' : savingsRate >= 0 ? 'review.c.cashflow.positive' : 'review.c.cashflow.negative', params: { pct: Math.abs(savingsRate ?? 0) } },
    },
    wrapup: {
      headline,
      wins: sev('good'),
      watch: [...sev('alert'), ...sev('warn')],
      nextSteps: i.health.recommendations,
      commentary: { key: 'review.c.wrapup', params: { count: i.health.recommendations.length } },
    },
  };
}
