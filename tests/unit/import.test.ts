import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sniffFile, decodeText } from '../../src/shared/import/sniff';
import { toGrid } from '../../src/shared/import/grid';
import { pickParser } from '../../src/shared/import/registry';
import { otsarParser } from '../../src/shared/import/otsar';
import { guessMapping, headerSignature, mappingValid, parseWithMapping } from '../../src/shared/import/generic';
import { assignOccurrences, dedupeKey } from '../../src/shared/import/dedupe';
import { detectDateFormat, parseAmount, parseDateCell } from '../../src/shared/import/values';
import type { ParseResult } from '../../src/shared/import/types';

const DIR = 'fixtures/otsar-hahayal/synthetic';
const expected = JSON.parse(readFileSync(`${DIR}/expected.json`, 'utf8'));

function load(file: string) {
  const bytes = new Uint8Array(readFileSync(path.join(DIR, file)));
  const s = sniffFile(file, bytes.length, bytes);
  if (!s.ok) throw new Error(s.error);
  return { kind: s.kind, grid: toGrid(s.kind, bytes) };
}
function parse(file: string): ParseResult {
  const { grid } = load(file);
  const p = pickParser(grid);
  return p ? p.parse(grid) : parseWithMapping(grid, guessMapping(grid));
}
const sum = (r: ParseResult) => r.rows.reduce((a, x) => a + x.amountMinor, 0);

describe('sniff & decode (AC4.1)', () => {
  it('detects formats by magic bytes, not extension', () => {
    expect(load('otsar_2026-10.xlsx').kind).toBe('xlsx');
    expect(load('otsar_2026-10.xls').kind).toBe('xls');
    expect(load('html_table.xls').kind).toBe('html');
    expect(load('generic_bank.csv').kind).toBe('csv');
  });
  it('rejects large, wrong-type and binary files before parsing', () => {
    expect(sniffFile('a.xlsx', 6 * 1024 * 1024, new Uint8Array([1]))).toEqual({ ok: false, error: 'file_too_large' });
    expect(sniffFile('a.pdf', 10, new Uint8Array([1]))).toEqual({ ok: false, error: 'file_type' });
    expect(sniffFile('a.csv', 10, new Uint8Array([0x89, 0x50, 0, 0, 1]))).toEqual({ ok: false, error: 'unsupported_file' });
    expect(sniffFile('a.csv', 0, new Uint8Array([]))).toEqual({ ok: false, error: 'file_empty' });
  });
  it('decodes UTF-8 BOM, UTF-8 and windows-1255', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    expect(decodeText(new TextEncoder().encode('שלום'))).toBe('שלום');
    expect(decodeText(new Uint8Array([0xf9, 0xec, 0xe5, 0xed]))).toBe('שלום');
  });
});

describe('values', () => {
  it('parses amounts', () => {
    expect(parseAmount(12.5)).toBe(1250);
    expect(parseAmount('₪ 1,234.56')).toBe(123456);
    expect(parseAmount('(10.00)')).toBe(-1000);
    expect(parseAmount('25.10-')).toBe(-2510);
    expect(parseAmount('-7')).toBe(-700);
    expect(parseAmount('x')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
  it('parses dates and detects formats', () => {
    expect(parseDateCell(46296)).toBe('2026-10-01');
    expect(parseDateCell('01/10/2026')).toBe('2026-10-01');
    expect(parseDateCell('01.10.26')).toBe('2026-10-01');
    expect(parseDateCell('2026-10-01')).toBe('2026-10-01');
    expect(parseDateCell('31/13/2026')).toBeNull();
    expect(parseDateCell('10/31/2026', 'mdy')).toBe('2026-10-31');
    expect(detectDateFormat(['01/02/2026', '13/02/2026'])).toBe('dmy');
    expect(detectDateFormat(['02/13/2026', '02/01/2026'])).toBe('mdy');
    expect(detectDateFormat([46296, 46297])).toBe('serial');
    expect(detectDateFormat(['2026-10-01'])).toBe('ymd');
  });
});

describe('Otsar Ha-Hayal parser (AC4.3)', () => {
  for (const f of ['otsar_2026-10.xlsx', 'otsar_2026-10.xls', 'otsar_2026-10-15_2026-11-14.xlsx', 'html_table.xls', 'otsar_shifted_header.xlsx']) {
    it(`${f}: rows, sums, dates, closing balance, continuity`, () => {
      const { grid } = load(f);
      expect(pickParser(grid)?.id).toBe('otsar-hahayal');
      const r = parse(f);
      const e = expected[f];
      expect(r.errors).toEqual([]);
      expect(r.rows).toHaveLength(e.rows);
      expect(sum(r)).toBe(e.sumMinor);
      expect(r.rows[0]!.date).toBe(e.first);
      expect(r.rows[r.rows.length - 1]!.date).toBe(e.last);
      expect(r.closingBalance).toEqual(e.closing);
      expect(r.warnings).not.toContain('balance_mismatch');
      if (e.period) expect(r.period).toEqual(e.period);
      if (e.mask) expect(r.accountMask).toBe(e.mask);
      // padded descriptions are trimmed and collapsed
      expect(r.rows.every((x) => x.description === x.description.trim() && !/\s{2}/.test(x.description))).toBe(true);
    });
  }
  it('treats 0 balances on rows that are not the last of the day as missing', () => {
    const r = parse('otsar_2026-10.xlsx');
    expect(r.rows.some((x) => x.balanceMinor === null)).toBe(true);
    expect(r.rows.some((x) => x.balanceMinor === 0)).toBe(false);
  });
  it('identical same-day rows get occurrence 1 and 2', () => {
    const r = parse('otsar_2026-10.xlsx');
    const bits = r.rows.filter((x) => x.date === '2026-10-14' && x.amountMinor === -5000);
    expect(bits.map((x) => x.occ)).toEqual([1, 2]);
    expect(new Set(bits.map(dedupeKey)).size).toBe(2);
  });
  it('newest-first and oldest-first files produce the same chronological rows', () => {
    const a = parse('otsar_2026-10.xlsx');
    const b = parse('otsar_2026-10-15_2026-11-14.xlsx');
    const keysA = new Set(a.rows.map(dedupeKey));
    const overlap = b.rows.filter((x) => x.date <= '2026-10-31');
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.every((x) => keysA.has(dedupeKey(x)))).toBe(true);
    expect(b.rows.filter((x) => !keysA.has(dedupeKey(x)))).toHaveLength(expected['otsar_2026-10-15_2026-11-14.xlsx'].newRowsAfterOctober);
  });
  it('broken.xlsx reports row-level errors and keeps valid rows (AC4.7)', () => {
    const r = parse('broken.xlsx');
    expect(r.rows).toHaveLength(5);
    expect(r.errors).toEqual(expected['broken.xlsx'].errors);
  });
  it('header row is found by Hebrew column names, not position', () => {
    const { grid } = load('otsar_shifted_header.xlsx');
    expect(otsarParser.detect(grid)).toBe(1);
    expect(grid[8]?.filter(Boolean)).toContain('יתרה');
  });
});

describe('generic mapper (AC4.4)', () => {
  it('windows-1255 CSV with other headers, signed amount, dd.MM.yy', () => {
    const { grid } = load('generic_bank.csv');
    expect(pickParser(grid)).toBeNull();
    const m = guessMapping(grid);
    expect(m.headerRow).toBe(2);
    expect(m.columns).toMatchObject({ date: 0, description: 1, amount: 2, balance: 3, reference: 4 });
    expect(m.dateFormat).toBe('dmy');
    expect(mappingValid(m)).toBe(true);
    expect(headerSignature(grid, m.headerRow)).toBe('תאריך|פרטים|סכום|יתרה|אסמכתא');
    const r = parseWithMapping(grid, m);
    const e = expected['generic_bank.csv'];
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(e.rows);
    expect(sum(r)).toBe(e.sumMinor);
    expect(r.closingBalance).toEqual(e.closing);
    expect(r.warnings).toEqual([]);
  });
  it('sign flip for files where spending is positive', () => {
    const { grid } = load('generic_bank.csv');
    const m = { ...guessMapping(grid), negate: true };
    expect(sum(parseWithMapping(grid, m))).toBe(-expected['generic_bank.csv'].sumMinor);
  });
  it('debit/credit columns', () => {
    const grid = [['Date', 'Details', 'Debit', 'Credit'], ['01/10/2026', 'A', '10.00', ''], ['02/10/2026', 'B', '', '5.50']];
    const m = guessMapping(grid);
    expect(m.columns).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
    expect(parseWithMapping(grid, m).rows.map((x) => x.amountMinor)).toEqual([-1000, 550]);
  });
});

describe('dedupe (AC4.6)', () => {
  it('occurrence index and key', () => {
    const rows = assignOccurrences([
      { row: 1, date: '2026-10-01', amountMinor: -100, description: 'A', reference: '1' },
      { row: 2, date: '2026-10-01', amountMinor: -100, description: 'a ', reference: '1' },
      { row: 3, date: '2026-10-01', amountMinor: -100, description: 'A', reference: '2' },
    ]);
    expect(rows.map((r) => r.occ)).toEqual([1, 2, 1]);
    expect(dedupeKey(rows[0]!)).toBe('v1|2026-10-01|-100|1|a|1');
  });
});

const PRIVATE = 'fixtures/otsar-hahayal/private';
const privateFiles = existsSync(PRIVATE) ? readdirSync(PRIVATE).filter((f) => /\.(xlsx|xls|csv)$/i.test(f)) : [];
describe.runIf(privateFiles.length > 0)('real Otsar exports (private, never printed)', () => {
  for (const f of privateFiles)
    it(`private file #${privateFiles.indexOf(f) + 1}`, () => {
      const bytes = new Uint8Array(readFileSync(path.join(PRIVATE, f)));
      const s = sniffFile(f, bytes.length, bytes);
      expect(s.ok).toBe(true);
      const grid = toGrid((s as { kind: 'xlsx' }).kind, bytes);
      const p = pickParser(grid);
      expect(p?.id).toBe('otsar-hahayal');
      const r = p!.parse(grid);
      expect(r.rows.length > 0).toBe(true);
      expect(r.errors.length).toBe(0);
      expect(r.warnings.includes('balance_mismatch')).toBe(false);
    });
});
