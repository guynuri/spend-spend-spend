/** Budget math (PLAN §10.4). Pure; inputs are SQL aggregates. */
import type { MonthStr } from '../dates';
import { mean } from './common';

export interface BudgetRow {
  category_id: string;
  effective_from: MonthStr;
  limit_minor: number | null;
  /** 1 = applies only to `effective_from` and overrides the recurring limit for that month. */
  one_time?: number;
}
/**
 * How a category is budgeted and reported:
 * - `monthly` (default): its own monthly budget line.
 * - `general`: pooled with the other general expenses into one line with one shared monthly limit
 *   (clothing, hair, small purchases that change every month); per-category spending is still kept.
 * - `occasional`: irregular, lumpy spending (vacations, gifts): budgeted per year and averaged over
 *   12 months instead of being compared month by month.
 */
export type BudgetMode = 'monthly' | 'general' | 'occasional';
export const BUDGET_MODES: readonly BudgetMode[] = ['monthly', 'general', 'occasional'];
/** Id of the pooled "general expenses" line (never a category id: those are nanoids). */
export const GENERAL_ID = 'general';
/** Name of the pooled line, in the household's language (category names are stored in one language too). */
export const GENERAL_NAME: Record<'en' | 'he', string> = { en: 'General expenses', he: 'הוצאות כלליות' };
export const generalName = (locale: string) => GENERAL_NAME[locale === 'he' ? 'he' : 'en'];

export interface BudgetCategoryIn {
  id: string;
  name: string;
  grp: 'fixed' | 'variable' | null;
  archived: boolean;
  mode?: BudgetMode;
}
export interface YearlyBudgetRow {
  category_id: string;
  year: string;
  limit_minor: number | null;
}
export type BudgetStatus = 'over' | 'watch' | 'on_pace';

/**
 * limit(category, M) = a one-time row for exactly M if any, else the recurring row with greatest
 * effective_from ≤ M; none or NULL → unbudgeted.
 */
export function budgetFor(rows: BudgetRow[], categoryId: string, month: MonthStr): { limit: number | null; oneTime: boolean } {
  let best: BudgetRow | null = null;
  for (const r of rows) {
    if (r.category_id !== categoryId) continue;
    if (r.one_time) {
      if (r.effective_from === month) return { limit: r.limit_minor, oneTime: true };
    } else if (r.effective_from <= month && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return { limit: best?.limit_minor ?? null, oneTime: false };
}

export const limitFor = (rows: BudgetRow[], categoryId: string, month: MonthStr): number | null => budgetFor(rows, categoryId, month).limit;

/** Yearly limit of an occasional category: the row with the greatest year ≤ Y; none or NULL → none. */
export function yearlyLimitFor(rows: YearlyBudgetRow[], categoryId: string, year: string): number | null {
  let best: YearlyBudgetRow | null = null;
  for (const r of rows) if (r.category_id === categoryId && r.year <= year && (!best || r.year > best.year)) best = r;
  return best?.limit_minor ?? null;
}

const modeOf = (c: { mode?: BudgetMode }): BudgetMode => c.mode ?? 'monthly';

/**
 * The monthly budget lines of month M as (id, limit, spent): every monthly category with a limit, plus the
 * general pool when it has one. Occasional categories (yearly budgets) are never part of the monthly totals.
 * Shared by the budget history chart and the health score so they cannot disagree with the Budget page.
 */
export function monthlyBudgetLines(
  categories: BudgetCategoryIn[],
  budgets: BudgetRow[],
  generalBudgets: BudgetRow[],
  spentOf: (categoryId: string, month: MonthStr) => number,
  month: MonthStr,
): { id: string; limit: number; spent: number }[] {
  const out: { id: string; limit: number; spent: number }[] = [];
  let general = 0;
  for (const c of categories) {
    const mode = modeOf(c);
    if (mode === 'general') general += spentOf(c.id, month);
    if (mode !== 'monthly') continue;
    const l = limitFor(budgets, c.id, month);
    if (l !== null) out.push({ id: c.id, limit: l, spent: spentOf(c.id, month) });
  }
  const gl = limitFor(generalBudgets, GENERAL_ID, month);
  if (gl !== null) out.push({ id: GENERAL_ID, limit: gl, spent: general });
  return out;
}

export function utilization(spent: number, limit: number): number {
  if (limit === 0) return spent > 0 ? Infinity : 0;
  return spent / limit;
}

export function budgetStatus(spent: number, limit: number, grp: 'fixed' | 'variable' | null, f: number | null): BudgetStatus | null {
  if (spent > limit) return 'over';
  if (f === null) return null;
  const u = utilization(spent, limit);
  if (grp === 'variable' && (u >= 0.9 || (u >= 0.5 && u > f + 0.1))) return 'watch';
  return 'on_pace';
}

export interface BudgetLine {
  /** A category id, or GENERAL_ID for the pooled general-expenses line. */
  categoryId: string;
  name: string;
  /** Present on the general line only: its categories and what each spent this month (largest first). */
  members?: { categoryId: string; name: string; spentMinor: number; avg3Minor: number }[];
  grp: 'fixed' | 'variable' | null;
  limitMinor: number | null;
  /** The limit applies to this month only (else it carries forward every month). */
  oneTime: boolean;
  spentMinor: number;
  remainingMinor: number | null;
  utilization: number | null;
  status: BudgetStatus | null;
  avg3Minor: number;
}
export interface BudgetView {
  month: MonthStr;
  f: number | null;
  lines: BudgetLine[];
  totals: {
    budgetedMinor: number;
    spentBudgetedMinor: number;
    pctSpent: number | null;
    pace: 'ahead' | 'under' | 'on_pace' | null;
    /** Expenses(M) not in a monthly budget line and not occasional (those have their own yearly section). */
    unbudgetedSpentMinor: number;
    expensesMinor: number;
    counts: Record<BudgetStatus, number>;
    fixed: { budgetedMinor: number; spentMinor: number };
    variable: { budgetedMinor: number; spentMinor: number };
  };
  allocation: { budgetedMinor: number; avgIncomeMinor: number; months: MonthStr[] };
  unsplitCardMinor: number;
  occasional: OccasionalView;
}

export interface OccasionalLine {
  categoryId: string;
  name: string;
  yearLimitMinor: number | null;
  /** Spent from January through M. */
  ytdMinor: number;
  /** Spent in M. */
  monthMinor: number;
  /** Spent over the 12 months ending with M (the honest "per year" figure; ÷ 12 = per month). */
  last12Minor: number;
  remainingMinor: number | null;
  utilization: number | null;
  status: BudgetStatus | null;
}
export interface OccasionalView {
  year: string;
  lines: OccasionalLine[];
  totals: { yearBudgetedMinor: number; ytdMinor: number; monthMinor: number; last12Minor: number };
}

/** Yearly status: over the limit, watch from 90 % used; spending is lumpy, so there is no pace rule. */
export function yearlyStatus(ytd: number, limit: number): BudgetStatus {
  if (ytd > limit) return 'over';
  return utilization(ytd, limit) >= 0.9 ? 'watch' : 'on_pace';
}

export function buildBudgetView(input: {
  month: MonthStr;
  f: number | null;
  categories: BudgetCategoryIn[];
  budgets: BudgetRow[];
  /** −Σ amount of expense-category lines in M, per category. */
  spent: Map<string, number>;
  /** Monthly spent per category for the avg3 months. */
  history: Map<string, Map<MonthStr, number>>;
  avgMonths: MonthStr[];
  /** Expenses(M) per §10.1 (incl. uncategorized outflows). */
  expensesMinor: number;
  avgIncomeMinor: number;
  incomeMonths: MonthStr[];
  unsplitCardMinor: number;
  /** Shared monthly limit of the general pool (category_id = GENERAL_ID). */
  generalBudgets?: BudgetRow[];
  yearlyBudgets?: YearlyBudgetRow[];
  /** Occasional categories: spent January..M and over the 12 months ending with M. */
  ytd?: Map<string, number>;
  last12?: Map<string, number>;
  generalName?: string;
}): BudgetView {
  const lines: BudgetLine[] = [];
  const counts: Record<BudgetStatus, number> = { over: 0, watch: 0, on_pace: 0 };
  const fixed = { budgetedMinor: 0, spentMinor: 0 };
  const variable = { budgetedMinor: 0, spentMinor: 0 };
  let budgeted = 0;
  let spentBudgeted = 0;
  const avg3Of = (cid: string) => Math.round(mean(input.avgMonths.map((m) => input.history.get(cid)?.get(m) ?? 0)));
  const members: NonNullable<BudgetLine['members']> = [];
  const occ: OccasionalLine[] = [];
  const year = input.month.slice(0, 4);
  let hasGeneral = false;
  for (const c of input.categories) {
    const mode = modeOf(c);
    const spent = input.spent.get(c.id) ?? 0;
    if (mode === 'general') {
      if (!c.archived) hasGeneral = true;
      if (!c.archived || spent !== 0) members.push({ categoryId: c.id, name: c.name, spentMinor: spent, avg3Minor: avg3Of(c.id) });
      continue;
    }
    if (mode === 'occasional') {
      const lim = yearlyLimitFor(input.yearlyBudgets ?? [], c.id, year);
      const ytd = input.ytd?.get(c.id) ?? 0;
      const last12 = input.last12?.get(c.id) ?? 0;
      if (c.archived && lim === null && ytd === 0 && last12 === 0) continue;
      occ.push({
        categoryId: c.id,
        name: c.name,
        yearLimitMinor: lim,
        ytdMinor: ytd,
        monthMinor: spent,
        last12Minor: last12,
        remainingMinor: lim === null ? null : lim - ytd,
        utilization: lim === null ? null : utilization(ytd, lim),
        status: lim === null ? null : yearlyStatus(ytd, lim),
      });
      continue;
    }
    const { limit, oneTime } = budgetFor(input.budgets, c.id, input.month);
    if (c.archived && limit === null && spent === 0) continue;
    const avg3 = avg3Of(c.id);
    const status = limit === null ? null : budgetStatus(spent, limit, c.grp, input.f);
    if (status) counts[status]++;
    if (limit !== null) {
      budgeted += limit;
      spentBudgeted += spent;
      const g = c.grp === 'fixed' ? fixed : variable;
      g.budgetedMinor += limit;
      g.spentMinor += spent;
    }
    lines.push({ categoryId: c.id, name: c.name, grp: c.grp, limitMinor: limit, oneTime, spentMinor: spent, remainingMinor: limit === null ? null : limit - spent, utilization: limit === null ? null : utilization(spent, limit), status, avg3Minor: avg3 });
  }
  const g = budgetFor(input.generalBudgets ?? [], GENERAL_ID, input.month);
  if (hasGeneral || members.length || g.limit !== null) {
    // the pool behaves like one variable category
    members.sort((a, b) => b.spentMinor - a.spentMinor || a.name.localeCompare(b.name));
    const spent = members.reduce((a, m) => a + m.spentMinor, 0);
    const status = g.limit === null ? null : budgetStatus(spent, g.limit, 'variable', input.f);
    if (status) counts[status]++;
    if (g.limit !== null) {
      budgeted += g.limit;
      spentBudgeted += spent;
      variable.budgetedMinor += g.limit;
      variable.spentMinor += spent;
    }
    lines.push({
      categoryId: GENERAL_ID,
      name: input.generalName ?? GENERAL_NAME.en,
      members,
      grp: 'variable',
      limitMinor: g.limit,
      oneTime: g.oneTime,
      spentMinor: spent,
      remainingMinor: g.limit === null ? null : g.limit - spent,
      utilization: g.limit === null ? null : utilization(spent, g.limit),
      status,
      avg3Minor: members.reduce((a, m) => a + m.avg3Minor, 0),
    });
  }
  occ.sort((a, b) => b.ytdMinor - a.ytdMinor || b.last12Minor - a.last12Minor || a.name.localeCompare(b.name));
  const occMonth = occ.reduce((a, l) => a + l.monthMinor, 0);
  const pctSpent = budgeted > 0 ? spentBudgeted / budgeted : null;
  const f = input.f;
  const pace = pctSpent === null || f === null ? null : pctSpent > f + 0.05 ? 'ahead' : pctSpent < f - 0.05 ? 'under' : 'on_pace';
  return {
    month: input.month,
    f,
    lines,
    totals: { budgetedMinor: budgeted, spentBudgetedMinor: spentBudgeted, pctSpent, pace, unbudgetedSpentMinor: input.expensesMinor - spentBudgeted - occMonth, expensesMinor: input.expensesMinor, counts, fixed, variable },
    allocation: { budgetedMinor: budgeted, avgIncomeMinor: input.avgIncomeMinor, months: input.incomeMonths },
    unsplitCardMinor: input.unsplitCardMinor,
    occasional: {
      year,
      lines: occ,
      totals: {
        yearBudgetedMinor: occ.reduce((a, l) => a + (l.yearLimitMinor ?? 0), 0),
        ytdMinor: occ.reduce((a, l) => a + l.ytdMinor, 0),
        monthMinor: occMonth,
        last12Minor: occ.reduce((a, l) => a + l.last12Minor, 0),
      },
    },
  };
}
