import { describe, expect, it } from 'vitest';
import { MAX_STATEMENT_LINES, statementFlip, statementLines, withChargeColumn } from '../../src/client/features/ledger/statement';
import { guessMapping, parseWithMapping } from '../../src/shared/import/generic';

const sum = (ls: { minor: number }[]) => ls.reduce((a, l) => a + l.minor, 0);
const other = (n: number) => `+${n}`;

describe('card statement → split lines', () => {
  it('aligns signs to the payment, sums per rule category, keeps refunds signed', () => {
    // Issuer shows charges positive, a refund negative; bank payment is -900.
    const rows = [
      { amountMinor: 40000, description: 'Shufersal' },
      { amountMinor: 35000, description: 'Cafe A' },
      { amountMinor: 25000, description: 'Shufersal 2' },
      { amountMinor: -10000, description: 'Refund B' },
    ];
    expect(statementFlip(rows, -90000)).toBe(-1);
    const ls = statementLines(rows, -90000, ['groc', null, 'groc', null], other);
    expect(ls).toEqual([
      { categoryId: 'groc', minor: -65000, note: '' },
      { categoryId: null, minor: -35000, note: 'Cafe A' },
      { categoryId: null, minor: 10000, note: 'Refund B' },
    ]);
    expect(sum(ls)).toBe(-90000);
  });

  it('no flip when signs already match; empty descriptions are fine', () => {
    const rows = [
      { amountMinor: -500, description: '' },
      { amountMinor: -700, description: 'x' },
    ];
    expect(statementFlip(rows, -1000)).toBe(1);
    expect(sum(statementLines(rows, -1000, [null, null], other))).toBe(-1200);
  });

  it(`merges rows past ${MAX_STATEMENT_LINES} lines into one; total is kept`, () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ amountMinor: -(i + 1) * 100, description: `r${i}` }));
    const ls = statementLines(rows, -1, rows.map(() => null), other);
    expect(ls).toHaveLength(MAX_STATEMENT_LINES);
    expect(ls.at(-1)!.note).toBe(`+${50 - MAX_STATEMENT_LINES + 1}`);
    expect(sum(ls)).toBe(sum(rows.map((r) => ({ minor: r.amountMinor }))));
  });
});

describe('card statement columns', () => {
  it('prefers the charged amount over the transaction amount (installments, foreign currency)', () => {
    const grid = [
      ['תאריך עסקה', 'שם בית העסק', 'סכום העסקה', 'סכום החיוב'],
      ['01/11/2026', 'רהיטים תשלום 1 מ-10', '5,000.00', '500.00'],
      ['02/11/2026', 'AMAZON', '$30.00', '110.50'],
      ['03/11/2026', 'קפה', '20', '20'],
    ];
    const m = withChargeColumn(grid, guessMapping(grid));
    expect(m.columns.amount).toBe(3);
    const r = parseWithMapping(grid, m);
    expect(r.rows.map((x) => Math.abs(x.amountMinor))).toEqual([50000, 11050, 2000]);
  });
});
