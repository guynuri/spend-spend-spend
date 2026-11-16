import { norm } from '../../../shared/normalize';
import type { Cell, Grid, ParseResult } from '../../../shared/import/types';
import { mappingValid, parseWithMapping, type Mapping } from '../../../shared/import/generic';
import { cellText, parseAmount } from '../../../shared/import/values';
import { FileError, parseCardStatement, parseFile } from '../import/parseFile';

/** splitsPut allows 30 lines: one is left for an unassigned remainder. */
export const MAX_STATEMENT_LINES = 29;
// Card files carry both the transaction amount and the amount actually charged this month
// (installments, foreign currency): the charge is what the bank payment covers.
const CHARGE = /^(סכום (ה)?חיוב|charge amount|billing amount|amount charged)/;

/**
 * A card statement file → parsed rows (errors kept, never dropped). Known card issuers go through
 * the card parser; anything else falls back to a guessed mapping on the charged amount.
 */
export async function readStatement(file: File): Promise<ParseResult & { card: boolean }> {
  try {
    const r = await parseCardStatement(file);
    // Rows without a charge (pending, not billed yet) are not errors: look them up in the sheet.
    const grid = r.errors.some((e) => e.code === 'amount_invalid') ? (await parseFile(file)).grid : [];
    return { ...dropUnbilledErrors(r, grid), card: true };
  } catch (e) {
    if (!(e instanceof FileError) || e.code !== 'not_card') throw e;
  }
  const p = await parseFile(file);
  // A recognized bank statement (salary, rent, the card payment itself) is not a card statement.
  if (p.result) throw new FileError('not_card');
  if (!p.guess) throw new FileError('unsupported_file');
  return { ...parseStatementGrid(p.grid, p.guess), card: false };
}

const unbilled = (c: Cell | undefined) => c === null || c === undefined || cellText(c) === '' || parseAmount(c) === 0;
const chargeColumn = (row: Cell[] | undefined) => (row ?? []).findIndex((c) => CHARGE.test(norm(c === null ? '' : String(c))));

/** Drops `amount_invalid` errors for rows whose charge cell is blank or 0 (`row` is the 1-based sheet row). */
export function dropUnbilledErrors<T extends ParseResult>(r: T, grid: Grid): T {
  const h = grid.slice(0, 40).findIndex((row) => chargeColumn(row) >= 0);
  if (h < 0) return r;
  const col = chargeColumn(grid[h]);
  return { ...r, errors: r.errors.filter((e) => e.code !== 'amount_invalid' || !unbilled(grid[e.row - 1]?.[col])) };
}

/**
 * Generic mapping, but the charged-amount column is the amount when the file has one; rows with no
 * charge (pending, not billed yet) are not part of this payment and are left out without an error.
 */
export function parseStatementGrid(grid: Grid, guess: Mapping): ParseResult {
  const charge = chargeColumn(grid[guess.headerRow]);
  const m = charge >= 0 ? { ...guess, columns: { ...guess.columns, amount: charge, debit: undefined, credit: undefined } } : guess;
  if (!mappingValid(m)) throw new FileError('unsupported_file');
  const billed = charge < 0 ? grid : grid.filter((r, i) => i <= m.headerRow || !unbilled(r[charge]));
  return parseWithMapping(billed, m);
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
