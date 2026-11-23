/**
 * Suggested budget limits (D-R26). Every number is explained to the user in the same words:
 *
 * - **Usual amount:** the median of the last complete months (up to 6; a month without spending counts
 *   as 0). A median ignores one unusual month, so a single big purchase doesn't inflate the limit.
 * - **Fixed bills** (categories in the "fixed" group: rent, utilities, insurance…): suggested at the usual
 *   amount, rounded up to ₪10 — a bill can't be squeezed.
 * - **Everyday spending** (the "variable" group, and the pooled general expenses): the usual amount minus
 *   the chosen squeeze (0 / 5 / 10 %), rounded to ₪50 (never below ₪50).
 * - **Occasional categories** (vacations, gifts): a yearly limit = the last 12 months' total, rounded up
 *   to ₪100.
 * - **Income check:** expected income = the median monthly income of the same months. If fixed bills +
 *   everyday limits + occasional spending spread per month + the savings target (a share of income) don't
 *   fit, the everyday limits shrink by one common factor until they do — but never below 70 % of their
 *   usual amount (a cut deeper than that wouldn't be kept). If even that doesn't fit, `shortfallMinor`
 *   says by how much.
 */
import type { MonthStr } from '../dates';
import { GENERAL_ID, type BudgetMode } from './budget';

export interface SuggestCategory {
  id: string;
  name: string;
  grp: 'fixed' | 'variable' | null;
  mode: BudgetMode;
  system: boolean;
}
export type SuggestKind = 'fixed' | 'everyday' | 'general' | 'occasional';
export interface SuggestLine {
  /** A category id, or GENERAL_ID for the pooled general expenses. */
  categoryId: string;
  name: string;
  kind: SuggestKind;
  /** Usual monthly amount (median); for occasional lines, the last 12 months' total. */
  usualMinor: number;
  /** Monthly limit (yearly for occasional). */
  suggestedMinor: number;
  /** True when the income check lowered it below the squeezed usual amount. */
  scaled: boolean;
}
export interface Suggestion {
  months: MonthStr[];
  incomeMinor: number;
  savingsTargetMinor: number;
  squeeze: number;
  lines: SuggestLine[];
  totals: { fixedMinor: number; everydayMinor: number; occasionalMonthlyMinor: number; monthlyMinor: number; leftForSavingsMinor: number };
  /** > 0 when the limits can't fit income minus the savings target even at the deepest allowed cut. */
  shortfallMinor: number;
}

export const SQUEEZES = [0, 0.05, 0.1] as const;
export const SAVINGS_TARGETS = [0, 0.05, 0.1, 0.15, 0.2] as const;
/** Everyday limits are never cut below this share of their usual amount. */
export const MIN_SCALE = 0.7;

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}
const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const ceilTo = (x: number, step: number) => Math.ceil(x / step) * step;
const floorTo = (x: number, step: number) => Math.floor(x / step) * step;
/** ₪ steps in minor units. */
const S10 = 1000;
const S50 = 5000;
const S100 = 10000;

export function suggestBudgets(i: {
  /** Complete months to take the usual amounts from (oldest first; the caller passes up to 6). */
  months: MonthStr[];
  /** category → month → spent (top-level expense categories). */
  spent: Map<string, Map<string, number>>;
  /** month → income. */
  income: Map<string, number>;
  /** category → spent over the last 12 months (occasional categories). */
  yearSpent: Map<string, number>;
  categories: SuggestCategory[];
  squeeze: number;
  savingsTarget: number;
  generalName: string;
}): Suggestion | null {
  if (!i.months.length) return null;
  const usualOf = (id: string) => median(i.months.map((m) => Math.max(0, i.spent.get(id)?.get(m) ?? 0)));
  const lines: SuggestLine[] = [];
  const cats = i.categories.filter((c) => !c.system);
  for (const c of cats) {
    if (c.mode === 'general') continue;
    if (c.mode === 'occasional') {
      const year = Math.max(0, i.yearSpent.get(c.id) ?? 0);
      if (year > 0) lines.push({ categoryId: c.id, name: c.name, kind: 'occasional', usualMinor: year, suggestedMinor: ceilTo(year, S100), scaled: false });
      continue;
    }
    const usual = usualOf(c.id);
    if (usual <= 0) continue;
    if (c.grp === 'fixed') lines.push({ categoryId: c.id, name: c.name, kind: 'fixed', usualMinor: usual, suggestedMinor: ceilTo(usual, S10), scaled: false });
    else lines.push({ categoryId: c.id, name: c.name, kind: 'everyday', usualMinor: usual, suggestedMinor: Math.max(S50, roundTo(usual * (1 - i.squeeze), S50)), scaled: false });
  }
  // general expenses: one pooled line, the median of the pooled monthly totals
  const general = cats.filter((c) => c.mode === 'general');
  if (general.length) {
    const usual = median(i.months.map((m) => Math.max(0, general.reduce((a, c) => a + (i.spent.get(c.id)?.get(m) ?? 0), 0))));
    if (usual > 0) lines.push({ categoryId: GENERAL_ID, name: i.generalName, kind: 'general', usualMinor: usual, suggestedMinor: Math.max(S50, roundTo(usual * (1 - i.squeeze), S50)), scaled: false });
  }

  const incomeMinor = median(i.months.map((m) => Math.max(0, i.income.get(m) ?? 0)));
  const savingsTargetMinor = Math.round(incomeMinor * i.savingsTarget);
  const sum = (k: SuggestKind[]) => lines.filter((l) => k.includes(l.kind)).reduce((a, l) => a + l.suggestedMinor, 0);
  const fixed = sum(['fixed']);
  const occMonthly = Math.round(sum(['occasional']) / 12);
  const flexible = lines.filter((l) => l.kind === 'everyday' || l.kind === 'general');
  let shortfallMinor = 0;
  if (incomeMinor > 0 && flexible.length) {
    const room = incomeMinor - savingsTargetMinor - fixed - occMonthly;
    const want = sum(['everyday', 'general']);
    if (want > room) {
      const floor = flexible.reduce((a, l) => a + Math.max(S50, floorTo(l.usualMinor * MIN_SCALE, S50)), 0);
      const factor = room > 0 ? room / want : 0;
      for (const l of flexible) {
        const minimum = Math.max(S50, floorTo(l.usualMinor * MIN_SCALE, S50));
        const next = Math.max(minimum, floorTo(l.suggestedMinor * factor, S50));
        if (next < l.suggestedMinor) {
          l.suggestedMinor = next;
          l.scaled = true;
        }
      }
      if (floor > room) shortfallMinor = floor - Math.max(0, room);
    }
  }
  lines.sort((a, b) => ['fixed', 'everyday', 'general', 'occasional'].indexOf(a.kind) - ['fixed', 'everyday', 'general', 'occasional'].indexOf(b.kind) || b.usualMinor - a.usualMinor);
  const everyday = sum(['everyday', 'general']);
  const monthlyMinor = fixed + everyday;
  return {
    months: i.months,
    incomeMinor,
    savingsTargetMinor,
    squeeze: i.squeeze,
    lines,
    totals: { fixedMinor: fixed, everydayMinor: everyday, occasionalMonthlyMinor: occMonthly, monthlyMinor, leftForSavingsMinor: incomeMinor - monthlyMinor - occMonthly },
    shortfallMinor,
  };
}
