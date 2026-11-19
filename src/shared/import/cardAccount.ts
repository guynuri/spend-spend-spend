/**
 * A card-issuer file (Isracard / Amex, Max, Cal) imported into a credit-card account (D-R20). Unlike a
 * statement split, the account wants every purchase as soon as the issuer lists it:
 * - billed rows use the charged ILS amount (what the bank pays);
 * - rows not billed yet (charge cell empty or 0) use the transaction amount when it is in shekels;
 *   foreign-currency ones wait for the file that bills them (their ILS amount isn't known yet);
 * - installment k of n ("תשלום 2 מתוך 12") is dated k − 1 months after the purchase and keyed by k, so
 *   each month's installment is its own row and repeated files never drop one as a duplicate.
 */
import { norm } from '../normalize';
import { addMonths, clampDay, dayOf, monthOf } from '../dates';
import { finalizeRows, type RawRow } from './finalize';
import { guessColumns } from './generic';
import { cellText, detectDateFormat, parseAmount, parseDateCell } from './values';
import type { Cell, Grid, ParseResult } from './types';

const TXN_AMOUNT = /^(סכום (ה)?עסקה|סכום מקורי|transaction amount|original amount)/;
const CURRENCY = /^(מטבע|currency)/;
const SHEKEL = /^(₪|ש"?ח|שקל|ils|nis)?$/i;
const INSTALLMENT = /תשלום\s*(\d{1,2})\s*(?:מתוך|מ-?)\s*(\d{1,2})|(\d{1,2})\s*מתוך\s*(\d{1,2})/;
const text = (c: Cell | undefined) => norm(c === null || c === undefined ? '' : String(c));

/** Installment k of n found in any cell of the row except the description; null for a one-off purchase. */
export function installmentOf(row: Cell[], descriptionCol?: number): { k: number; n: number } | null {
  for (let j = 0; j < row.length; j++) {
    if (j === descriptionCol) continue;
    const m = INSTALLMENT.exec(cellText(row[j] ?? null));
    if (!m) continue;
    const k = Number(m[1] ?? m[3]);
    const n = Number(m[2] ?? m[4]);
    if (k >= 1 && n >= 2 && k <= n) return { k, n };
  }
  return null;
}

/** Header row (the closest one at or above `row`, 0-based) whose cells name a charge or amount column. */
function headerAbove(grid: Grid, row: number): number {
  for (let i = row; i >= 0; i--) {
    const c = guessColumns(grid[i] ?? []);
    if (c.date !== undefined && c.description !== undefined && c.amount !== undefined) return i;
  }
  return -1;
}

export function cardAccountResult(r: ParseResult, grid: Grid): ParseResult & { unbilled: number } {
  const raw: RawRow[] = [];
  const shift = (date: string, row: Cell[], descCol: number | undefined, reference: string | null | undefined) => {
    const inst = installmentOf(row, descCol);
    if (!inst || inst.k === 1) return { date, reference: inst ? `${reference ?? ''} 1/${inst.n}`.trim() : (reference ?? null) };
    return { date: clampDay(addMonths(monthOf(date), inst.k - 1), dayOf(date)), reference: `${reference ?? ''} ${inst.k}/${inst.n}`.trim() };
  };
  const descColOf = new Map<number, number | undefined>();
  const colsFor = (h: number) => {
    if (!descColOf.has(h)) descColOf.set(h, guessColumns(grid[h] ?? []).description);
    return descColOf.get(h);
  };
  for (const x of r.rows) {
    const g = grid[x.row - 1] ?? [];
    const h = headerAbove(grid, x.row - 2);
    raw.push({ ...x, ...shift(x.date, g, h >= 0 ? colsFor(h) : undefined, x.reference) });
  }
  // rows the format parser rejected for want of a charged amount: not billed yet
  let unbilled = 0;
  const errors = r.errors.filter((e) => {
    if (e.code !== 'amount_invalid') return true;
    const g = grid[e.row - 1] ?? [];
    const h = headerAbove(grid, e.row - 2);
    if (h < 0) return true;
    const header = grid[h] ?? [];
    const cols = guessColumns(header);
    const charge = parseAmount(g[cols.amount!] ?? null);
    if (charge !== null && charge !== 0) return true; // a real amount problem
    const txn = header.findIndex((c) => TXN_AMOUNT.test(text(c)));
    // the currency column that belongs to the transaction amount: the first one after it, else any
    const after = header.findIndex((c, j) => j > txn && CURRENCY.test(text(c)));
    const cur = after >= 0 ? after : header.findIndex((c) => CURRENCY.test(text(c)));
    const amount = txn >= 0 ? parseAmount(g[txn] ?? null) : null;
    // not billed yet: drop the row unless its shekel amount is known (it arrives with the billing file)
    if (amount === null || amount === 0 || (cur >= 0 && !SHEKEL.test(cellText(g[cur] ?? null).replace(/\s/g, '')))) return false;
    // an installment deal: the transaction amount is the whole deal, not this installment, so it waits too
    if (installmentOf(g, cols.description)) return false;
    const sample = grid.slice(h + 1, h + 21).map((row) => row[cols.date!] ?? null);
    const date = parseDateCell(g[cols.date!] ?? null, detectDateFormat(sample) === 'serial' ? 'dmy' : detectDateFormat(sample));
    const description = cellText(g[cols.description!] ?? null);
    if (!date || !description) return true;
    const reference = cols.reference === undefined ? null : cellText(g[cols.reference] ?? null) || null;
    raw.push({ row: e.row, valueDate: null, amountMinor: -amount, description, operationType: null, balanceMinor: null, ...shift(date, g, cols.description, reference) });
    unbilled++;
    return false;
  });
  return { ...finalizeRows(r.parserId, raw, errors, {}), unbilled };
}
