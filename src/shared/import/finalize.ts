import { assignOccurrences } from './dedupe';
import type { NormRow, ParseResult, RowError } from './types';
import { MAX_IMPORT_ROWS } from './types';

export type RawRow = Omit<NormRow, 'occ'>;

/**
 * Continuity: across consecutive present balances, bal_k = bal_j + Σ amounts(j..k].
 * A present 0 that breaks continuity is treated as "balance missing" (PLAN §9.2).
 */
function continuity(rows: RawRow[]): { ok: boolean; rows: RawRow[] } {
  const out = rows.map((r) => ({ ...r }));
  let last: number | null = null;
  let since = 0;
  let ok = true;
  for (const r of out) {
    since += r.amountMinor;
    if (r.balanceMinor === null || r.balanceMinor === undefined) continue;
    if (last !== null && last + since !== r.balanceMinor) {
      if (r.balanceMinor === 0) {
        r.balanceMinor = null;
        continue;
      }
      ok = false;
    }
    last = r.balanceMinor;
    since = 0;
  }
  return { ok, rows: out };
}

const stableByDate = (rows: RawRow[]) => rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i)).map((x) => x.r);

/** Orders rows chronologically, cleans zero balances, checks continuity, assigns occurrences. */
export function finalizeRows(parserId: string, raw: RawRow[], errors: RowError[], meta: { period?: { from: string; to: string } | null; accountMask?: string | null }): ParseResult {
  const warnings: ParseResult['warnings'] = [];
  // 0 on a day where another row has a real balance = "missing".
  const dayHasBalance = new Set(raw.filter((r) => r.balanceMinor !== null && r.balanceMinor !== undefined && r.balanceMinor !== 0).map((r) => r.date));
  // Field caps match the server's row validation, so one over-long cell never fails the whole upload.
  const cap = (s: string | null | undefined, n: number) => (s ? s.slice(0, n).trim() || null : (s ?? null));
  const cleaned = raw.map((r) => ({
    ...r,
    description: r.description.slice(0, 300).trim(),
    reference: cap(r.reference, 60),
    operationType: cap(r.operationType, 60),
    balanceMinor: r.balanceMinor === 0 && dayHasBalance.has(r.date) ? null : r.balanceMinor,
  }));
  const newestFirst = cleaned.length > 1 && cleaned[0]!.date > cleaned[cleaned.length - 1]!.date;
  const a = stableByDate(cleaned);
  const b = stableByDate([...cleaned].reverse());
  const tries = newestFirst ? [b, a] : [a, b];
  let chosen = continuity(tries[0]!);
  if (!chosen.ok) {
    const alt = continuity(tries[1]!);
    if (alt.ok) chosen = alt;
    else warnings.push('balance_mismatch');
  }
  let rows = assignOccurrences(chosen.rows);
  if (rows.length > MAX_IMPORT_ROWS) {
    rows = rows.slice(0, MAX_IMPORT_ROWS);
    warnings.push('too_many_rows');
  }
  if (!rows.length) warnings.push('no_rows');
  let closing: ParseResult['closingBalance'] = null;
  for (const r of rows) if (r.balanceMinor !== null && r.balanceMinor !== undefined) closing = { date: r.date, minor: r.balanceMinor };
  const period = meta.period ?? (rows.length ? { from: rows[0]!.date, to: rows[rows.length - 1]!.date } : undefined);
  return { parserId, rows, errors, period, accountMask: meta.accountMask ?? null, closingBalance: closing, warnings };
}
