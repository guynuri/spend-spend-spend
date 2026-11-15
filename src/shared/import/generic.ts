import { norm } from '../normalize';
import { cellText, detectDateFormat, isEmptyRow, parseAmount, parseDateCell, type DateFormat } from './values';
import { finalizeRows, type RawRow } from './finalize';
import type { Grid, ParseResult, RowError } from './types';

export type MapField = 'date' | 'valueDate' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'reference' | 'type';
export interface Mapping {
  headerRow: number;
  columns: Partial<Record<MapField, number>>;
  dateFormat: DateFormat;
  /** Single-amount files where spending is positive. */
  negate: boolean;
}

const SYN: Record<MapField, string[]> = {
  date: ['תאריך', 'תאריך עסקה', 'תאריך פעולה', 'date', 'transaction date'],
  valueDate: ['תאריך ערך', 'value date'],
  description: ['תיאור', 'פרטים', 'תיאור פעולה', 'שם בית עסק', 'שם בית העסק', 'description', 'details', 'payee', 'merchant'],
  debit: ['חובה', 'debit', 'withdrawal', 'withdrawals'],
  credit: ['זכות', 'credit', 'deposit', 'deposits'],
  amount: ['סכום', 'amount', 'סכום חיוב', 'סכום העסקה', 'סכום פעולה'],
  balance: ['יתרה', 'balance', 'יתרה בש"ח'],
  reference: ['אסמכתא', 'reference', 'ref', 'מספר אסמכתא'],
  type: ['סוג פעולה', 'סוג', 'type', 'סוג עסקה'],
};
const SYN_N = Object.fromEntries(Object.entries(SYN).map(([k, v]) => [k, v.map(norm)])) as Record<MapField, string[]>;
export const MAP_FIELDS: MapField[] = ['date', 'description', 'amount', 'debit', 'credit', 'balance', 'reference', 'type', 'valueDate'];

/** First row (of 40) with ≥ 3 text cells, followed by ≥ 2 rows filling ≥ 2 of the same columns. */
export function guessHeaderRow(grid: Grid): number {
  for (let i = 0; i < Math.min(40, grid.length); i++) {
    const r = grid[i] ?? [];
    const textCols = r.map((c, j) => (typeof c === 'string' && c.trim() ? j : -1)).filter((j) => j >= 0);
    if (textCols.length < 3) continue;
    let good = 0;
    for (let k = i + 1; k < Math.min(grid.length, i + 6) && good < 2; k++) {
      const n = textCols.filter((j) => grid[k]?.[j] !== null && grid[k]?.[j] !== '' && grid[k]?.[j] !== undefined).length;
      if (n >= 2) good++;
    }
    if (good >= 2) return i;
  }
  return 0;
}

export function guessColumns(header: (string | number | null)[]): Partial<Record<MapField, number>> {
  const cols: Partial<Record<MapField, number>> = {};
  const used = new Set<number>();
  const cells = header.map((c) => norm(c === null ? '' : String(c)));
  // exact matches first (so "תאריך ערך" never steals "תאריך"), then prefix matches
  for (const pass of ['exact', 'prefix'] as const)
    for (const f of MAP_FIELDS) {
      if (cols[f] !== undefined) continue;
      const j = cells.findIndex((c, idx) => !used.has(idx) && c && SYN_N[f].some((s) => (pass === 'exact' ? c === s : c.startsWith(s + ' '))));
      if (j >= 0) {
        cols[f] = j;
        used.add(j);
      }
    }
  return cols;
}

export function headerSignature(grid: Grid, headerRow: number): string {
  return (grid[headerRow] ?? []).map((c) => norm(c === null ? '' : String(c))).join('|');
}

export function guessMapping(grid: Grid): Mapping {
  const headerRow = guessHeaderRow(grid);
  const columns = guessColumns(grid[headerRow] ?? []);
  const sample = grid.slice(headerRow + 1, headerRow + 21).map((r) => (columns.date === undefined ? null : (r[columns.date] ?? null)));
  return { headerRow, columns, dateFormat: detectDateFormat(sample), negate: false };
}

export const mappingValid = (m: Mapping) => m.columns.date !== undefined && m.columns.description !== undefined && (m.columns.amount !== undefined || (m.columns.debit !== undefined && m.columns.credit !== undefined));

export function parseWithMapping(grid: Grid, m: Mapping): ParseResult {
  const c = m.columns;
  const raw: RawRow[] = [];
  const errors: RowError[] = [];
  for (let i = m.headerRow + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (isEmptyRow(r)) continue;
    const get = (k: MapField) => (c[k] === undefined ? null : (r[c[k]!] ?? null));
    const date = parseDateCell(get('date'), m.dateFormat === 'serial' ? 'dmy' : m.dateFormat);
    const reference = cellText(get('reference')) || null;
    if (!date) {
      if ((get('date') === null || get('date') === '') && !reference) continue;
      errors.push({ row: i + 1, code: 'date_invalid' });
      continue;
    }
    let amount: number | null;
    if (c.amount !== undefined) {
      amount = parseAmount(get('amount'));
      if (amount !== null && m.negate) amount = -amount;
    } else {
      const cr = parseAmount(get('credit'));
      const db = parseAmount(get('debit'));
      amount = cr === null && db === null ? null : Math.abs(cr ?? 0) - Math.abs(db ?? 0);
    }
    if (amount === null || amount === 0) {
      errors.push({ row: i + 1, code: 'amount_invalid' });
      continue;
    }
    if (Math.abs(amount) > 1e11) {
      errors.push({ row: i + 1, code: 'amount_too_large' });
      continue;
    }
    const description = cellText(get('description'));
    const operationType = cellText(get('type')) || null;
    if (!description && !operationType) {
      errors.push({ row: i + 1, code: 'description_missing' });
      continue;
    }
    const bal = get('balance');
    raw.push({ row: i + 1, date, valueDate: parseDateCell(get('valueDate'), m.dateFormat === 'serial' ? 'dmy' : m.dateFormat), amountMinor: amount, description: description || operationType!, reference, operationType, balanceMinor: bal === null || bal === '' ? null : parseAmount(bal) });
  }
  return finalizeRows('generic', raw, errors, {});
}
