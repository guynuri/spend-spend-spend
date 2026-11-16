/**
 * AI payload builders (PLAN §11.3, AC13.2). Pure and minimal: categorization sends only scrubbed
 * merchant text, direction, a rounded amount and category names; review sends aggregates only.
 */
import { norm } from '../normalize';
import { isGenericPayee } from '../domain/ledger';
import type { ReviewSnapshot } from '../domain/review';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** Digit runs of ≥ 5 (phones, account/card numbers, references) and e-mails removed; ≤ 60 chars. */
export function scrubText(s: string): string {
  return s
    .replace(EMAIL, ' ')
    .replace(/\d[\d-]{3,}\d/g, (m) => (m.replace(/\D/g, '').length >= 5 ? ' ' : m))
    .replace(/\d{5,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Person-to-person transfers carry people's names: never sent. */
const P2P = ['העברה', 'bit', 'ביט', 'paybox', 'פייבוקס', 'pepper', 'העברת', 'transfer'].map(norm);
export const isP2P = (description: string, operationType: string | null) => {
  const d = norm(description);
  const o = norm(operationType ?? '');
  return P2P.some((p) => o.includes(p) || d.includes(p));
};

export interface CategorizeSource {
  key: string;
  description: string;
  operationType: string | null;
  amountMinor: number;
}
export interface CategorizeItem {
  i: number;
  text: string;
  dir: 'in' | 'out';
  amount: number;
}

/** Up to 40 distinct merchant keys → payload items + the index map back to keys. */
export function buildCategorizePayload(rows: CategorizeSource[], categoryNames: string[]) {
  const seen = new Set<string>();
  const items: CategorizeItem[] = [];
  const keys: string[] = [];
  for (const r of rows) {
    if (items.length >= 40) break;
    // Payment apps, transfers, checks, ATM: the payee differs every time, so a merchant category makes no sense.
    if (!r.key || seen.has(r.key) || isP2P(r.description, r.operationType) || isGenericPayee(r.description)) continue;
    const text = scrubText(r.description);
    if (!text) continue;
    seen.add(r.key);
    keys.push(r.key);
    items.push({ i: items.length, text, dir: r.amountMinor >= 0 ? 'in' : 'out', amount: Math.round(Math.abs(r.amountMinor) / 1000) * 10 });
  }
  return { payload: { categories: categoryNames, items }, keys };
}

/** Review payload: aggregates only — no descriptions, notes, references, account or member names. */
export function buildReviewPayload(s: ReviewSnapshot) {
  const sh = (x: number) => Math.round(x * 100);
  return {
    month: s.month,
    score: s.summary.score,
    scoreLabel: s.summary.label,
    scoreChange: s.summary.change,
    income: s.summary.incomeMinor / 100,
    spending: s.summary.expensesMinor / 100,
    leftOver: s.summary.netMinor / 100,
    incomePrev: s.income.prevMinor / 100,
    spendingPrev: s.spending.prevMinor / 100,
    spendingByCategory: s.spending.byCategory.slice(0, 10).map((c) => ({ category: c.name ?? 'uncategorized', amount: c.amountMinor / 100, sharePct: sh(c.share) })),
    incomeByCategory: s.income.byCategory.slice(0, 5).map((c) => ({ category: c.name ?? 'uncategorized', amount: c.amountMinor / 100, sharePct: sh(c.share) })),
    budget: { withinLimit: s.budget.ok, budgeted: s.budget.total, overLines: s.budget.lines.filter((l) => l.overMinor > 0).map((l) => ({ category: l.name, over: l.overMinor / 100 })) },
    goals: s.goals.items.map((g) => ({ goal: g.name, progressPct: sh(g.progress), status: g.status })),
    savingsRatePct: s.cashflow.savingsRate === null ? null : sh(s.cashflow.savingsRate),
    forecast: s.cashflow.forecast ? { monthEnd: s.cashflow.forecast.eomMinor / 100, lowest: s.cashflow.forecast.lowMinor / 100 } : null,
    signals: [...s.wrapup.watch, ...s.wrapup.wins].map((x) => x.key),
    nextSteps: s.wrapup.nextSteps.map((r) => r.key),
  };
}
