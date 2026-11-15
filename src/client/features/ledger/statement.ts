import { norm } from '../../../shared/normalize';
import type { Grid, ParseResult } from '../../../shared/import/types';
import type { Mapping } from '../../../shared/import/generic';
import { FileError, parseFile } from '../import/parseFile';

/** splitsPut allows 30 lines: one is left for an unassigned remainder. */
export const MAX_STATEMENT_LINES = 29;
// Card files carry both the transaction amount and the amount actually charged this month
// (installments, foreign currency): the charge is what the bank payment covers.
const CHARGE = /^(סכום (ה)?חיוב|charge amount|billing amount|amount charged)/;

/**
 * A card statement file → parsed rows (errors kept, never dropped).
 * ponytail: generic bank mapping with a charge-column override; swap for a card parser when one exists.
 */
export async function readStatement(file: File): Promise<ParseResult> {
  const p = await parseFile(file);
  if (p.result) return p.result;
  const g = await import('../../../shared/import/generic');
  if (!p.guess) throw new FileError('unsupported_file');
  const m = withChargeColumn(p.grid, p.guess);
  if (!g.mappingValid(m)) throw new FileError('unsupported_file');
  return g.parseWithMapping(p.grid, m);
}

/** Uses the charged-amount column as the amount when the file has one. */
export function withChargeColumn(grid: Grid, m: Mapping): Mapping {
  const charge = (grid[m.headerRow] ?? []).findIndex((c) => CHARGE.test(norm(c === null ? '' : String(c))));
  return charge >= 0 ? { ...m, columns: { ...m.columns, amount: charge, debit: undefined, credit: undefined } } : m;
}

/** -1 when the statement's charges carry the opposite sign of the payment (issuer convention). */
export function statementFlip(rows: { amountMinor: number }[], total: number) {
  const sum = rows.reduce((a, r) => a + r.amountMinor, 0);
  return sum !== 0 && (sum < 0) !== (total < 0) ? -1 : 1;
}

export interface StatementLine {
  categoryId: string | null;
  /** In the payment's sign; refunds have the opposite sign. */
  minor: number;
  note: string;
}

/**
 * Rows → split lines: rows with a rule category are summed per category, the rest stay one line
 * each (note = description), lines past the cap merge into one. Lines always sum to flip × row total.
 */
export function statementLines(rows: { amountMinor: number; description: string }[], total: number, categoryIds: (string | null)[], otherNote: (n: number) => string): StatementLine[] {
  const flip = statementFlip(rows, total);
  const byCat = new Map<string, number>();
  const free: StatementLine[] = [];
  rows.forEach((r, i) => {
    const c = categoryIds[i];
    if (c) byCat.set(c, (byCat.get(c) ?? 0) + r.amountMinor * flip);
    else free.push({ categoryId: null, minor: r.amountMinor * flip, note: r.description.slice(0, 120) });
  });
  const out: StatementLine[] = [...[...byCat].map(([categoryId, minor]) => ({ categoryId, minor, note: '' })), ...free];
  if (out.length > MAX_STATEMENT_LINES) {
    const rest = out.splice(MAX_STATEMENT_LINES - 1);
    out.push({ categoryId: null, minor: rest.reduce((a, l) => a + l.minor, 0), note: otherNote(rest.length) });
  }
  return out;
}
