import { excelSerialToDate, isValidDate } from '../dates';
import type { Cell } from './types';

/** Amount cell → minor units. Strings: ₪, spaces, thousands commas removed; (x) and x- are negative. */
export function parseAmount(c: Cell): number | null {
  if (c === null || c === '') return null;
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c * 100) : null;
  let s = c.replace(/[₪\s\u00A0]|ILS|NIS|ש"ח|ש״ח/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Math.round(Number(s) * 100);
  return neg ? -v : v;
}

export type DateFormat = 'serial' | 'dmy' | 'mdy' | 'ymd';

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidDate(s) ? s : null;
}

/** Date cell → YYYY-MM-DD. Numbers are Excel serials; strings follow `fmt` (default: dmy, then ISO). */
export function parseDateCell(c: Cell, fmt: DateFormat = 'dmy'): string | null {
  if (c === null || c === '') return null;
  if (typeof c === 'number') return excelSerialToDate(c);
  const s = c.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/.exec(s);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
  return fmt === 'mdy' ? ymd(y, a, b) : ymd(y, b, a);
}

/** Picks a date format from sample values (PLAN §9.3): MM/dd only if dd/MM is impossible. */
export function detectDateFormat(values: Cell[]): DateFormat {
  const vs = values.filter((v) => v !== null && v !== '').slice(0, 20);
  if (vs.length && vs.every((v) => typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim()))) return 'serial';
  if (vs.some((v) => /^\d{4}[-/.]/.test(String(v)))) return 'ymd';
  let dmyOk = true;
  let mdyOk = true;
  for (const v of vs) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]/.exec(String(v).trim());
    if (!m) continue;
    if (Number(m[2]) > 12) dmyOk = false;
    if (Number(m[1]) > 12) mdyOk = false;
  }
  return !dmyOk && mdyOk ? 'mdy' : 'dmy';
}

export const cellText = (c: Cell): string => (c === null ? '' : String(c)).replace(/\s+/g, ' ').trim();
export const isEmptyRow = (r: Cell[]) => r.every((c) => c === null || c === '');
