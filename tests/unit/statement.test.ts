import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_STATEMENT_LINES, dropUnbilledErrors, readStatement, parseStatementGrid, statementFlip, statementLines } from '../../src/client/features/ledger/statement';
import { guessMapping } from '../../src/shared/import/generic';

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
      { categoryId: null, minor: -35000, note: 'Cafe A', merchant: 'Cafe A', count: 1 },
      { categoryId: null, minor: 10000, note: 'Refund B', merchant: 'Refund B', count: 1 },
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

  it('one line per uncategorized business; a refund nets against its charge; zero lines dropped', () => {
    const rows = [
      { amountMinor: 8300, description: 'פספורטכארד שירותים פ' },
      { amountMinor: 622, description: 'פספורטכארד  שירותים פ' },
      { amountMinor: 29200, description: 'PAYPAL *GETYOURGUI' },
      { amountMinor: -29200, description: 'PAYPAL *GETYOURGUI' },
      { amountMinor: 1000, description: 'Cafe' },
    ];
    const ls = statementLines(rows, -9922, [null, null, null, null, null], other);
    expect(ls).toEqual([
      { categoryId: null, minor: -8922, note: 'פספורטכארד שירותים פ', merchant: 'פספורטכארד שירותים פ', count: 2 },
      { categoryId: null, minor: -1000, note: 'Cafe', merchant: 'Cafe', count: 1 },
    ]);
    expect(sum(ls)).toBe(-9922);
  });
});

describe('card statement columns', () => {
  it('prefers the charged amount over the transaction amount (installments, foreign currency)', () => {
    const grid = [
      ['תאריך עסקה', 'שם בית העסק', 'סכום העסקה', 'סכום החיוב'],
      ['01/11/2026', 'רהיטים תשלום 1 מ-10', '5,000.00', '500.00'],
      ['02/11/2026', 'AMAZON', '$30.00', '110.50'],
      ['03/11/2026', 'קפה', '20', '20'],
      ['04/11/2026', 'PENDING SHOP', '80', ''], // not billed yet: not part of this payment
      ['05/11/2026', 'FOREIGN', '$12', '0'],
      ['99/99/2026', 'BROKEN', '5', '5'],
    ];
    const r = parseStatementGrid(grid, guessMapping(grid));
    expect(r.rows.map((x) => Math.abs(x.amountMinor))).toEqual([50000, 11050, 2000]);
    expect(r.errors.map((e) => e.code)).toEqual(['date_invalid']); // only real errors count as skipped
  });
});

describe('card parser results', () => {
  it('blank / 0 charge rows are not reported as skipped; unreadable amounts still are', () => {
    const grid = [
      ['פירוט עסקאות'],
      ['תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב'],
      ['01/11/2026', 'PENDING', '80', ''],
      ['02/11/2026', 'FOREIGN', '12', '0'],
      ['03/11/2026', 'GARBAGE', '5', 'abc'],
    ];
    const r = { parserId: 'isracard', rows: [], warnings: [], errors: [3, 4, 5].map((row) => ({ row, code: 'amount_invalid' as const })) };
    expect(dropUnbilledErrors(r, grid).errors).toEqual([{ row: 5, code: 'amount_invalid' }]);
  });
});

describe('readStatement', () => {
  const file = (path: string) => new File([readFileSync(path)], path.split('/').pop()!);
  it('refuses a recognized bank statement (not a card statement)', async () => {
    await expect(readStatement(file('fixtures/otsar-hahayal/synthetic/otsar_2026-10.xlsx'))).rejects.toMatchObject({ code: 'not_card' });
  });
  it('a card issuer layout goes through the card parser', async () => {
    const csv = 'תאריך רכישה,שם בית עסק,סכום חיוב\n01/11/2026,שופרסל,400.00\n02/11/2026,קפה,20.00\n';
    const r = await readStatement(new File([csv], 'card.csv', { type: 'text/csv' }));
    expect(r.card).toBe(true);
    expect(r.rows).toHaveLength(2);
  });
});
