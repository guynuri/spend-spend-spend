import { finalizeRows, type RawRow } from './finalize';
import type { ParseResult } from './types';
import { parseAmount } from './values';

/** One text run from a PDF page (pdf.js text content): left edge x, baseline y, width, text. */
export interface PdfItem {
  page: number;
  x: number;
  y: number;
  w: number;
  s: string;
  rtl: boolean;
}

interface Column {
  left: number;
  right: number;
  text: string;
}
interface Line {
  page: number;
  y: number;
  items: PdfItem[];
}

const DATE = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/;
const AMOUNT = /^-?\d{1,3}(,\d{3})*\.\d{2}-?$|^-?\d+\.\d{2}-?$/;
const TOTAL = /סה"כ|סה״כ/;
// Where the transaction tables end (credit terms follow).
const END = /מסגרת הכרטיס/;
/** Columns are right-aligned under their header (RTL); a value may overhang its header edge slightly. */
const TOL = 2.5;

const right = (i: PdfItem) => i.x + i.w;
const gapJoin = (items: PdfItem[]) =>
  items.reduce((s, it, k) => {
    if (!k) return it.s.trim();
    const prev = items[k - 1]!;
    // Touching runs (a period, a quote) belong to the same word.
    const touching = Math.min(Math.abs(prev.x - right(it)), Math.abs(it.x - right(prev))) < 0.6;
    return touching ? s + it.s.trim() : `${s} ${it.s.trim()}`;
  }, '');

/** Reading order of one cell: right to left, but runs of left-to-right text keep their own order. */
function cellText(items: PdfItem[]): string {
  const byX = [...items].sort((a, b) => b.x - a.x);
  const out: PdfItem[] = [];
  let ltr: PdfItem[] = [];
  const flush = () => {
    out.push(...ltr.reverse());
    ltr = [];
  };
  for (const it of byX) {
    if (it.rtl) {
      flush();
      out.push(it);
    } else ltr.push(it);
  }
  flush();
  return gapJoin(out).replace(/\s+/g, ' ').trim();
}

function toLines(items: PdfItem[]): Line[] {
  const sorted = [...items].filter((i) => i.s.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  return lines;
}

/** Header words → columns: words closer than 5 units form one label (e.g. "שם בית עסק"). */
function headerColumns(line: Line): Column[] {
  const words = [...line.items].sort((a, b) => a.x - b.x);
  const cols: Column[] = [];
  for (const w of words) {
    const c = cols[cols.length - 1];
    if (c && w.x - c.right <= 5) {
      c.right = Math.max(c.right, right(w));
      c.text = `${w.s.trim()} ${c.text}`;
    } else cols.push({ left: w.x, right: right(w), text: w.s.trim() });
  }
  return cols;
}

const isHeader = (l: Line) => {
  const t = l.items.map((i) => i.s).join(' ');
  return /תאריך/.test(t) && /שם/.test(t) && /בית/.test(t) && /סכום/.test(t);
};

interface Layout {
  cols: Column[];
  date: number;
  merchant: number;
  charge: number;
}

function layoutOf(cols: Column[]): Layout | null {
  const idx = (re: RegExp) => cols.findIndex((c) => re.test(c.text));
  const merchant = idx(/שם.*בית|בית.*שם/);
  // Rightmost date column (the conversion-date column of a foreign table is further left).
  let date = -1;
  cols.forEach((c, i) => {
    if (/תאריך/.test(c.text) && (date < 0 || c.right > cols[date]!.right)) date = i;
  });
  // The charged amount (what this payment covers) is the leftmost amount column.
  const charge = idx(/סכום/);
  if (merchant < 0 || date < 0 || charge < 0) return null;
  return { cols, date, merchant, charge };
}

/** Column of an item: the header with the smallest right edge at or past the item's right edge. */
function columnOf(cols: Column[], it: PdfItem): number {
  const r = right(it);
  for (let i = 0; i < cols.length; i++) if (r <= cols[i]!.right + TOL) return i;
  return -1;
}

function isoDate(s: string): string | null {
  const m = DATE.exec(s.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y!.length === 2 ? `20${y}` : y!;
  const iso = `${year}-${mo}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d) ? null : iso;
}

/**
 * Isracard / American Express Israel monthly statement PDF (text layer) → card rows, charges
 * negative. Reads every "date … business … charged amount" table (foreign and domestic), joins a
 * business name that wraps to the next line, and checks the rows against the printed totals.
 * Returns no rows for a PDF that has no such table.
 */
export function parseCardPdf(items: PdfItem[]): ParseResult & { totalMinor: number | null } {
  const raw: RawRow[] = [];
  let layout: Layout | null = null;
  let last: { row: RawRow; line: Line } | null = null;
  let totalMinor: number | null = null;
  for (const line of toLines(items)) {
    const text = line.items.map((i) => i.s).join(' ');
    if (END.test(text)) {
      layout = null;
      continue;
    }
    if (isHeader(line)) {
      layout = layoutOf(headerColumns(line));
      last = null;
      continue;
    }
    if (!layout) continue;
    const cells = new Map<number, PdfItem[]>();
    for (const it of line.items) {
      const c = columnOf(layout.cols, it);
      if (c >= 0) cells.set(c, [...(cells.get(c) ?? []), it]);
    }
    const chargeText = cellText(cells.get(layout.charge) ?? []);
    const amount = AMOUNT.test(chargeText.replace(/\s/g, '')) ? parseAmount(chargeText) : null;
    if (TOTAL.test(text)) {
      if (amount !== null) totalMinor = (totalMinor ?? 0) + amount;
      layout = null; // the table ends at its total
      last = null;
      continue;
    }
    const date = isoDate(cellText(cells.get(layout.date) ?? []));
    const merchant = cellText(cells.get(layout.merchant) ?? []);
    if (date && amount !== null && merchant) {
      const row: RawRow = { row: raw.length + 1, date, amountMinor: -amount, description: merchant };
      raw.push(row);
      last = { row, line };
      continue;
    }
    // A business name that wraps: text only in the business column, right under the row.
    // Foreign tables print a reference number there; it is not part of the name.
    const onlyMerchant = cells.size === 1 && cells.has(layout.merchant) && line.items.every((i) => columnOf(layout!.cols, i) === layout!.merchant);
    if (last && onlyMerchant && last.line.page === line.page && last.line.y - line.y < 14 && !/^[\d\s/-]+$/.test(merchant)) {
      last.row.description = `${last.row.description} ${merchant}`;
      last = { row: last.row, line };
      continue;
    }
    last = null;
  }
  const result = finalizeRows('card_pdf', raw, [], {});
  return { ...result, totalMinor };
}
