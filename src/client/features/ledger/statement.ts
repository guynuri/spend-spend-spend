import { norm, normKey } from '../../../shared/normalize';
import { isGenericPayee } from '../../../shared/domain/ledger';
import { MAX_FILE_BYTES, type Cell, type Grid, type ParseResult } from '../../../shared/import/types';
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
export async function readStatement(file: File): Promise<ParseResult & { card: boolean; totalMinor?: number | null }> {
  if (await isPdf(file)) return readPdfStatement(file);
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

async function isPdf(file: File) {
  if (/\.pdf$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === '%PDF-';
}

/** Card statement PDF (Isracard / American Express layout) → rows plus the statement's printed total. */
async function readPdfStatement(file: File): Promise<ParseResult & { card: boolean; totalMinor: number | null }> {
  if (file.size > MAX_FILE_BYTES) throw new FileError('file_too_large');
  if (file.size === 0) throw new FileError('file_empty');
  let items, parseCardPdf;
  try {
    const [m, p] = await Promise.all([import('./pdfText'), import('../../../shared/import/cardPdf')]);
    parseCardPdf = p.parseCardPdf;
    items = await m.pdfItems(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    throw new FileError('pdf_unreadable', e instanceof Error && 'detail' in e ? String(e.detail) : e instanceof Error ? e.message : undefined);
  }
  const r = parseCardPdf(items);
  if (!r.rows.length) throw new FileError('pdf_no_table');
  return { ...r, card: true };
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
  /** Business name of an uncategorized line (rules can be learned / AI asked for it). */
  merchant?: string;
  /** Statement rows behind the line. */
  count?: number;
}

/**
 * Rows → split lines: rows with a rule category are summed per category, the rest are summed per
 * business (note = description; a charge and its refund cancel out), lines past the cap merge into
 * one. Lines always sum to flip × row total.
 */
export function statementLines(rows: { amountMinor: number; description: string }[], total: number, categoryIds: (string | null)[], otherNote: (n: number) => string): StatementLine[] {
  const flip = statementFlip(rows, total);
  const byCat = new Map<string, number>();
  const byMerchant = new Map<string, StatementLine>();
  const free: StatementLine[] = [];
  rows.forEach((r, i) => {
    const c = categoryIds[i];
    const minor = r.amountMinor * flip;
    if (c) {
      byCat.set(c, (byCat.get(c) ?? 0) + minor);
      return;
    }
    const key = normKey(r.description);
    const note = r.description.slice(0, 120);
    // Payment apps / transfers / ATM: a different counterparty each time, so never one line (or rule) for all.
    if (!key || isGenericPayee(r.description)) return void free.push({ categoryId: null, minor, note });
    const g = byMerchant.get(key);
    if (g) {
      g.minor += minor;
      g.count! += 1;
    } else {
      const line: StatementLine = { categoryId: null, minor, note, merchant: r.description.slice(0, 300), count: 1 };
      byMerchant.set(key, line);
      free.push(line);
    }
  });
  const out: StatementLine[] = [...[...byCat].map(([categoryId, minor]) => ({ categoryId, minor, note: '' })), ...free.filter((l) => l.minor !== 0)];
  if (out.length > MAX_STATEMENT_LINES) {
    const rest = out.splice(MAX_STATEMENT_LINES - 1);
    out.push({ categoryId: null, minor: rest.reduce((a, l) => a + l.minor, 0), note: otherNote(rest.reduce((a, l) => a + (l.count ?? 1), 0)) });
  }
  return out;
}
