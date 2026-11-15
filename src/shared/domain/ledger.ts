import { normKey, norm } from '../normalize';
import type { SplitLine } from '../schemas/ledger';

export type RuleSource = 'user' | 'learned' | 'ai' | 'seed';
export interface RuleLike {
  id: string;
  field: 'description' | 'operation_type';
  match: 'contains' | 'equals' | 'starts_with';
  pattern_norm: string;
  sign: 'any' | 'in' | 'out';
  category_id: string;
  source: RuleSource;
}

export const SOURCE_RANK: Record<RuleSource, number> = { user: 0, learned: 1, ai: 2, seed: 3 };

/** Precedence (PLAN §9.6): user > learned > ai > seed, then longer pattern first. */
export function sortRules<T extends RuleLike>(rules: T[]): T[] {
  return [...rules].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || b.pattern_norm.length - a.pattern_norm.length || a.id.localeCompare(b.id));
}

export function ruleMatches(r: RuleLike, tx: { description: string; operationType?: string | null; amountMinor: number }): boolean {
  if (r.sign === 'in' && tx.amountMinor <= 0) return false;
  if (r.sign === 'out' && tx.amountMinor >= 0) return false;
  const v = r.field === 'description' ? normKey(tx.description) : norm(tx.operationType ?? '');
  if (!v || !r.pattern_norm) return false;
  if (r.match === 'equals') return v === r.pattern_norm;
  if (r.match === 'starts_with') return v.startsWith(r.pattern_norm);
  return v.includes(r.pattern_norm);
}

/** First matching rule after precedence sorting. */
export function matchRule<T extends RuleLike>(rules: T[], tx: { description: string; operationType?: string | null; amountMinor: number }): T | null {
  for (const r of sortRules(rules)) if (ruleMatches(r, tx)) return r;
  return null;
}

/** SQL expression ranking rule source, used by the server's rule pass. */
export const SQL_RULE_ORDER = "CASE r.source WHEN 'user' THEN 0 WHEN 'learned' THEN 1 WHEN 'ai' THEN 2 ELSE 3 END, length(r.pattern_norm) DESC, r.id";

/** Learned rule key from a manually categorized transaction (PLAN §9.6). */
export function learnedRuleFor(tx: { description: string; amountMinor: number }) {
  return { field: 'description' as const, match: 'equals' as const, pattern_norm: normKey(tx.description), sign: tx.amountMinor >= 0 ? ('in' as const) : ('out' as const) };
}

/**
 * Scales a previous split to a new total (AC3.6): proportional, rounding remainder to the
 * largest line so the lines sum exactly to `total`.
 */
export function scaleSplit(lines: SplitLine[], total: number): SplitLine[] {
  const base = lines.reduce((a, l) => a + l.amountMinor, 0);
  if (!lines.length) return [];
  if (base === 0) return lines.map((l, i) => ({ ...l, id: undefined, amountMinor: i === 0 ? total : 0 }));
  const out = lines.map((l) => ({ categoryId: l.categoryId, note: l.note ?? null, amountMinor: Math.round((l.amountMinor * total) / base) }));
  const diff = total - out.reduce((a, l) => a + l.amountMinor, 0);
  let big = 0;
  out.forEach((l, i) => {
    if (Math.abs(l.amountMinor) > Math.abs(out[big]!.amountMinor)) big = i;
  });
  out[big]!.amountMinor += diff;
  return out;
}

export const splitSumOk = (lines: { amountMinor: number }[], total: number) => lines.reduce((a, l) => a + l.amountMinor, 0) === total;

/** CSV cell: quotes, and prefixes formula-like cells with ' (PLAN §18). */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Card-issuer lump detection on normalized description. */
export function isCardLump(descriptionNorm: string, amountMinor: number, patterns: string[]): boolean {
  if (amountMinor >= 0) return false;
  return patterns.some((p) => (/^[a-z ]+$/.test(p) ? new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(descriptionNorm) : descriptionNorm.includes(p)));
}
