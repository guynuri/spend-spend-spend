// TODO(otsar-real-file): verified only against synthetic fixtures built from REFERENCE.md §18
import { norm } from '../normalize';
import { cellText, isEmptyRow, parseAmount, parseDateCell } from './values';
import { finalizeRows, type RawRow } from './finalize';
import type { BankParser, Grid, RowError } from './types';

const HEADERS = {
  balance: 'יתרה',
  valueDate: 'תאריך ערך',
  credit: 'זכות',
  debit: 'חובה',
  description: 'תיאור',
  reference: 'אסמכתא',
  type: 'סוג פעולה',
  date: 'תאריך',
} as const;
type Col = keyof typeof HEADERS;
const NORMED = Object.entries(HEADERS).map(([k, v]) => [k as Col, norm(v)] as const);

function headerInfo(grid: Grid) {
  let best = { row: -1, score: 0, cols: {} as Partial<Record<Col, number>> };
  for (let i = 0; i < Math.min(30, grid.length); i++) {
    const cols: Partial<Record<Col, number>> = {};
    (grid[i] ?? []).forEach((c, j) => {
      if (typeof c !== 'string') return;
      const n = norm(c);
      for (const [k, v] of NORMED) if (n === v && cols[k] === undefined) cols[k] = j;
    });
    const score = Object.keys(cols).length;
    if (score >= 5 && score > best.score) best = { row: i, score, cols };
  }
  return best;
}

const PERIOD = /מתאריך\s*:?\s*([\d/.-]+)\s*עד\s*תאריך\s*:?\s*([\d/.-]+)/;

/** Period ("מתאריך … עד תאריך …") and account-number mask from the title rows above the header. */
export function metadata(grid: Grid, headerRow: number) {
  let period: { from: string; to: string } | null = null;
  let accountMask: string | null = null;
  for (let i = 0; i < headerRow; i++) {
    const text = (grid[i] ?? []).map(cellText).join(' ');
    const p = PERIOD.exec(text);
    if (p && !period) {
      const from = parseDateCell(p[1]!);
      const to = parseDateCell(p[2]!);
      if (from && to) period = { from, to };
    }
    if (!accountMask && /חשבון/.test(text) && !PERIOD.test(text)) {
      const runs = (text.replace(/\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}:\d{2}(:\d{2})?/g, ' ').match(/\d+(?:-\d+)*/g) ?? []).map((r) => r.replace(/-/g, ''));
      const longest = runs.sort((a, b) => b.length - a.length)[0];
      if (longest && longest.length >= 5) accountMask = longest.slice(-4);
    }
  }
  return { period, accountMask };
}

export const otsarParser: BankParser = {
  id: 'otsar-hahayal',
  labelKey: 'import.parsers.otsar',
  // FIBI group banks share one online-banking platform; assumed to share this layout (unverified).
  bankIds: ['otsar', 'fibi', 'massad'],
  // Without a description or operation-type column every row would fail; leave such files to the Mapper.
  detect: (grid) => {
    const h = headerInfo(grid);
    return h.cols.description !== undefined || h.cols.type !== undefined ? h.score / 8 : 0;
  },
  parse(grid) {
    const h = headerInfo(grid);
    const c = h.cols;
    const meta = metadata(grid, h.row);
    const raw: RawRow[] = [];
    const errors: RowError[] = [];
    for (let i = h.row + 1; i < grid.length; i++) {
      const r = grid[i] ?? [];
      if (isEmptyRow(r)) continue;
      const get = (k: Col) => (c[k] === undefined ? null : (r[c[k]!] ?? null));
      const date = parseDateCell(get('date'));
      const reference = cellText(get('reference')) || null;
      if (!date) {
        if (get('date') === null && !reference) continue; // totals / footer row
        errors.push({ row: i + 1, code: 'date_invalid' });
        continue;
      }
      const creditCell = get('credit');
      const debitCell = get('debit');
      const credit = parseAmount(creditCell);
      const debit = parseAmount(debitCell);
      const badCell = (cell: unknown, v: number | null) => cell !== null && cell !== '' && v === null;
      if (badCell(creditCell, credit) || badCell(debitCell, debit) || (!!credit && !!debit) || (!credit && !debit)) {
        errors.push({ row: i + 1, code: 'amount_invalid' });
        continue;
      }
      const amountMinor = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
      if (Math.abs(amountMinor) > 1e11) {
        errors.push({ row: i + 1, code: 'amount_too_large' });
        continue;
      }
      const description = cellText(get('description'));
      const operationType = cellText(get('type')) || null;
      if (!description && !operationType) {
        errors.push({ row: i + 1, code: 'description_missing' });
        continue;
      }
      const balCell = get('balance');
      raw.push({
        row: i + 1,
        date,
        valueDate: parseDateCell(get('valueDate')),
        amountMinor,
        description: description || operationType!,
        reference,
        operationType,
        balanceMinor: balCell === null || balCell === '' ? null : parseAmount(balCell),
      });
    }
    return finalizeRows('otsar-hahayal', raw, errors, meta);
  },
};
