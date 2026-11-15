/** File bytes → Cell grid. Browser-side only in the app (lazy chunk); also used by unit tests. */
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import Papa from 'papaparse';
import { cleanCell } from '../normalize';
import { decodeText } from './sniff';
import type { Cell, FileKind, Grid } from './types';

// ESM build (browser) needs the codepage tables registered; the CJS build (node tests) bundles them.
if (typeof (XLSX as { set_cptable?: unknown }).set_cptable === 'function') XLSX.set_cptable(cptable);

const clean = (c: unknown): Cell => {
  if (c === null || c === undefined) return null;
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  if (typeof c === 'boolean') return c ? 1 : 0;
  if (c instanceof Date) return null;
  const s = cleanCell(String(c));
  return s === '' ? null : s;
};

function sheetGrid(wb: XLSX.WorkBook): Grid {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const grid = rows.map((r) => (r as unknown[]).map(clean));
    if (grid.filter((r) => r.some((c) => c !== null)).length >= 2) return grid;
  }
  return [];
}

export function toGrid(kind: FileKind, bytes: Uint8Array): Grid {
  if (kind === 'xlsx' || kind === 'xls') return sheetGrid(XLSX.read(bytes, { type: 'array', cellDates: false, raw: true, codepage: 1255, dense: false }));
  const text = decodeText(bytes).replace(/^\uFEFF/, '');
  if (kind === 'html') return sheetGrid(XLSX.read(text, { type: 'string', cellDates: false, raw: true }));
  const res = Papa.parse<string[]>(text, { delimiter: '', delimitersToGuess: [',', ';', '\t'], skipEmptyLines: false });
  return res.data.map((r) => r.map(clean));
}
