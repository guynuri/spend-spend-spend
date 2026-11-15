/** Health score 0–100 with five weighted sub-scores (PLAN §10.6). Curves are ours (D-13). */
export type SubKey = 'savings' | 'debt' | 'cushion' | 'budget' | 'goals';
type Curve = [number, number][];
export const CURVES: Record<SubKey, Curve> = {
  savings: [[-0.1, 0], [0, 30], [0.1, 65], [0.2, 90], [0.3, 100]],
  debt: [[0, 100], [0.15, 90], [0.3, 65], [0.36, 50], [0.5, 15], [0.6, 0]],
  cushion: [[0, 0], [1, 25], [3, 70], [6, 100]],
  budget: [[0, 0], [0.5, 40], [0.8, 80], [1, 100]],
  goals: [[0, 0], [1, 100]],
};
export const WEIGHTS: Record<SubKey, number> = { savings: 25, debt: 20, cushion: 25, budget: 15, goals: 15 };
export const SUB_KEYS: SubKey[] = ['savings', 'debt', 'cushion', 'budget', 'goals'];

/** Piecewise-linear interpolation, clamped outside the breakpoints. */
export function lerp(c: Curve, x: number): number {
  if (x <= c[0]![0]) return c[0]![1];
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = c[i]!;
    const [x0, y0] = c[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return c[c.length - 1]![1];
}

export interface HealthInput {
  /** Window totals over the complete months among M, M−1, M−2. */
  income: number;
  expenses: number;
  months: number;
  debtPayments: number;
  liquid: number | null;
  budget: { ok: number; total: number; overMinor: number; budgetedMinor?: number; spentMinor?: number };
  goals: { onTrack: number; dated: number; extraMonthlyMinor: number };
}
export type Label = 'excellent' | 'good' | 'fair' | 'needs_attention';
export const label = (s: number): Label => (s >= 85 ? 'excellent' : s >= 70 ? 'good' : s >= 50 ? 'fair' : 'needs_attention');

export interface HealthResult {
  overall: number | null;
  label: Label | null;
  subs: Record<SubKey, { score: number | null; input: number | null; label: Label | null }>;
}

export function computeHealth(i: HealthInput): HealthResult {
  const monthlyExp = i.months > 0 ? i.expenses / i.months : 0;
  const s: Record<SubKey, { score: number | null; input: number | null }> = {
    savings: i.income > 0 ? { input: (i.income - i.expenses) / i.income, score: lerp(CURVES.savings, (i.income - i.expenses) / i.income) } : i.expenses > 0 ? { input: null, score: 0 } : { input: null, score: null },
    debt: i.income > 0 ? { input: i.debtPayments / i.income, score: lerp(CURVES.debt, i.debtPayments / i.income) } : { input: null, score: null },
    cushion: i.liquid !== null && monthlyExp > 0 ? { input: i.liquid / monthlyExp, score: lerp(CURVES.cushion, i.liquid / monthlyExp) } : { input: null, score: null },
    budget: i.budget.total > 0 ? { input: i.budget.ok / i.budget.total, score: lerp(CURVES.budget, i.budget.ok / i.budget.total) } : { input: null, score: null },
    goals: i.goals.dated > 0 ? { input: i.goals.onTrack / i.goals.dated, score: lerp(CURVES.goals, i.goals.onTrack / i.goals.dated) } : { input: null, score: null },
  };
  const present = SUB_KEYS.filter((k) => s[k].score !== null);
  const overall = present.length < 2 ? null : Math.round(present.reduce((a, k) => a + WEIGHTS[k] * s[k].score!, 0) / present.reduce((a, k) => a + WEIGHTS[k], 0));
  const subs = Object.fromEntries(SUB_KEYS.map((k) => [k, { ...s[k], score: s[k].score === null ? null : Math.round(s[k].score! * 10) / 10, label: s[k].score === null ? null : label(s[k].score!) }])) as HealthResult['subs'];
  return { overall, label: overall === null ? null : label(overall), subs };
}

export type RecKey = 'spend_less' | 'fix_budget' | 'add_cushion' | 'goals_on_track' | 'reduce_debt';
export interface Recommendation {
  key: RecKey;
  gain: number;
  amountMinor: number;
}

/** Counterfactual recommendations: recompute overall, keep gains ≥ 0.5, top 3 (PLAN §10.6). */
export function recommendations(i: HealthInput): Recommendation[] {
  const base = computeHealth(i).overall;
  if (base === null) return [];
  const exact = (x: HealthInput) => {
    // unrounded overall for precise gains
    const r = computeHealth(x);
    if (r.overall === null) return null;
    const present = SUB_KEYS.filter((k) => r.subs[k].score !== null);
    return present.reduce((a, k) => a + WEIGHTS[k] * r.subs[k].score!, 0) / present.reduce((a, k) => a + WEIGHTS[k], 0);
  };
  const b0 = exact(i)!;
  const m = Math.max(1, i.months);
  const monthlyIncome = i.income / m;
  const monthlyExp = i.expenses / m;
  const cands: [RecKey, HealthInput, number][] = [
    ['spend_less', { ...i, expenses: Math.max(0, i.expenses - 0.05 * i.income) }, Math.round(0.05 * monthlyIncome)],
    ['fix_budget', { ...i, budget: { ...i.budget, ok: i.budget.total } }, i.budget.overMinor],
    ['add_cushion', { ...i, liquid: i.liquid === null ? null : i.liquid + monthlyExp }, Math.round(monthlyExp)],
    ['goals_on_track', { ...i, goals: { ...i.goals, onTrack: i.goals.dated } }, i.goals.extraMonthlyMinor],
    ['reduce_debt', { ...i, debtPayments: i.debtPayments * 0.9 }, Math.round((0.1 * i.debtPayments) / m)],
  ];
  return cands
    .map(([key, x, amt]) => ({ key, gain: Math.round(((exact(x) ?? b0) - b0) * 10) / 10, amountMinor: amt }))
    .filter((r) => r.gain >= 0.5)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
}
