/**
 * Known Israeli bank / card-issuer export layouts, data-driven: a format is recognized by a set of
 * header names in one row; columns are then mapped by the shared synonym table (generic.ts SYN).
 * Anything unrecognized falls back to the manual Mapper.
 *
 * `verified: true` = header names taken from open-source parsers of real exports (no official bank
 * documentation exists): Hapoalim / Leumi / Mercantile (github.com/gana-rafi/Bank-Reports),
 * Discount-style "₪ זכות/חובה" (github.com/neven-h/IL-bank-parser), Isracard/Amex (eshaham/
 * israeli-bank-scrapers PR #1082, gana-rafi credit_card.py), Max (BarakFalach/ynab), Cal
 * (OzAvrahami/finance-tracker). Never checked against our own real files. Mizrahi is a guess.
 * Yahav, Jerusalem, One Zero, Pepper: no public samples; their usual headers are covered by the
 * synonym table, so they land in the Mapper pre-filled.
 */
import { norm } from '../normalize';
import { cellText, detectDateFormat } from './values';
import { finalizeRows, type RawRow } from './finalize';
import { guessColumns, rawRows } from './generic';
import { metadata } from './otsar';
import type { BankParser, Grid, RowError } from './types';

export interface BankFormat {
  id: string;
  bankIds: string[];
  /** Card-issuer statement: charges are positive numbers. */
  card?: boolean;
  /** Alternative header sets; one must appear entirely in a single row. */
  signatures: string[][];
  verified: boolean;
}

export const FORMATS: BankFormat[] = [
  { id: 'hapoalim', bankIds: ['hapoalim'], signatures: [['תאריך', 'הפעולה', 'אסמכתא', 'חובה', 'זכות']], verified: true },
  { id: 'leumi', bankIds: ['leumi'], signatures: [['תאריך', 'תיאור', 'אסמכתא', 'בחובה', 'בזכות']], verified: true },
  { id: 'discount', bankIds: ['discount', 'mercantile'], signatures: [['תאריך', 'יום ערך', 'תיאור התנועה', '₪ זכות/חובה']], verified: true },
  { id: 'mizrahi', bankIds: ['mizrahi'], signatures: [['תאריך', 'סוג תנועה', 'זכות', 'חובה']], verified: false },
  { id: 'isracard', bankIds: ['isracard', 'amex'], card: true, signatures: [['תאריך רכישה', 'שם בית עסק', 'סכום חיוב']], verified: true },
  { id: 'max', bankIds: ['max'], card: true, signatures: [['תאריך עסקה', 'שם בית העסק', 'קטגוריה', 'סכום חיוב']], verified: true },
  {
    id: 'cal',
    bankIds: ['cal'],
    card: true,
    signatures: [
      ['תאריך עסקה', 'שם בית העסק', 'סכום חיוב'],
      ['תאריך עסקה', 'בית עסק', 'סכום החיוב'],
    ],
    verified: true,
  },
];

const rowSet = (r: Grid[number] | undefined) => new Set((r ?? []).map((c) => norm(cellText(c))));

/** Rows holding a full signature, and the longest matching signature's size. */
function headerRows(f: BankFormat, grid: Grid) {
  const sigs = f.signatures.map((s) => s.map(norm));
  const rows: number[] = [];
  let size = 0;
  for (let i = 0; i < grid.length; i++) {
    const cells = rowSet(grid[i]);
    const hit = sigs.find((s) => s.every((h) => cells.has(h)));
    if (!hit) continue;
    rows.push(i);
    size = Math.max(size, hit.length);
  }
  return { rows, size };
}

/** Each header row starts a section (Isracard repeats headers for domestic / abroad); columns may move. */
function parseFormat(f: BankFormat, grid: Grid) {
  const { rows: heads } = headerRows(f, grid);
  const raw: RawRow[] = [];
  const errors: RowError[] = [];
  heads.forEach((h, k) => {
    const end = heads[k + 1] ?? grid.length;
    const columns = guessColumns(grid[h] ?? []);
    const sample = grid.slice(h + 1, Math.min(end, h + 21)).map((r) => (columns.date === undefined ? null : (r[columns.date] ?? null)));
    const part = rawRows(grid, { headerRow: h, columns, dateFormat: detectDateFormat(sample), negate: !!f.card }, end);
    raw.push(...part.raw);
    errors.push(...part.errors);
  });
  return finalizeRows(f.id, raw, errors, f.card ? {} : metadata(grid, heads[0] ?? 0));
}

const toParser = (f: BankFormat): BankParser => ({
  id: f.id,
  labelKey: '',
  bankIds: f.bankIds,
  card: f.card,
  // Above any partial Otsar match (≤ 0.875); longer signatures win ties between formats.
  detect: (grid) => {
    const { rows, size } = headerRows(f, grid);
    return rows.length ? 0.9 + size / 100 : 0;
  },
  parse: (grid) => parseFormat(f, grid),
});

/** Only verified layouts auto-parse; guesses reach the Mapper pre-filled by the synonym table. */
export const FORMAT_PARSERS = FORMATS.filter((f) => f.verified).map(toParser);
/** Card-issuer layouts: imported only into credit-card accounts (D-R20). */
export const CARD_PARSER_IDS: readonly string[] = FORMAT_PARSERS.filter((p) => p.card).map((p) => p.id);
/** Parser ids the import route accepts. */
export const PARSER_IDS = ['otsar-hahayal', 'generic', ...FORMAT_PARSERS.map((p) => p.id)] as [string, ...string[]];
