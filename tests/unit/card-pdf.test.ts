import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCardPdf, type PdfItem } from '../../src/shared/import/cardPdf';

/** Same extraction as the browser (src/client/features/ledger/pdfText.ts), via pdf.js in Node. */
async function items(path: string): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), disableFontFace: true, useSystemFonts: false }).promise;
  const out: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    for (const it of tc.items) if ('str' in it && it.str.trim()) out.push({ page: p, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, s: it.str, rtl: it.dir === 'rtl' });
  }
  return out;
}

describe('card statement PDF (Isracard / American Express layout)', () => {
  it('reads foreign and domestic tables, wraps, installments, refunds, page 2; ignores credit terms', async () => {
    const r = parseCardPdf(await items('fixtures/isracard/synthetic/statement.pdf'));
    expect(r.rows.map((x) => [x.date, x.amountMinor, x.description])).toEqual([
      ['2026-10-01', -31000, 'PAYPAL *TOURSHOP'],
      ['2026-10-02', -4250, 'מאפיית השקד'],
      ['2026-10-03', -18630, 'סופר הגבעה פארק המרכזי'], // name wraps to the next line
      ['2026-10-05', -125040, 'HOTEL NORDLICHT'], // the reference number under it is not part of the name
      ['2026-10-07', -3800, 'קפה לימון'],
      ['2026-10-09', -25000, 'דלק הצפון'],
      ['2026-10-12', -40000, 'מרפאת השן'], // installment: this month's charge, not the purchase amount
      ['2026-10-14', -2400, 'קפה לימון'],
      ['2026-10-20', 31000, 'PAYPAL *TOURSHOP'], // refund
      ['2026-10-21', -8990, 'ספרים ועוד'],
      ['2026-10-28', -3100, 'מאפיית השקד'],
    ]);
    expect(r.parserId).toBe('card_pdf');
    // Rows match the printed totals (foreign 1,250.40 + domestic 1,061.70).
    expect(r.totalMinor).toBe(231210);
    expect(-r.rows.reduce((a, x) => a + x.amountMinor, 0)).toBe(r.totalMinor);
  });

  it('credit terms, page breaks, currency marks and unreadable charges', () => {
    // Right-aligned columns: date ends at 520, business at 440, charge at 260.
    const at = (page: number, y: number, s: string, rightEdge: number, rtl = true): PdfItem => ({ page, x: rightEdge - 40, y, w: 40, s, rtl });
    const header = (page: number, y: number) => [at(page, y, 'תאריך', 520), at(page, y, 'שם בית עסק', 440), at(page, y, 'סכום החיוב', 260)];
    const row = (page: number, y: number, d: string, m: string, a: string) => [at(page, y, d, 520, false), at(page, y, m, 440), at(page, y, a, 260, false)];
    const r = parseCardPdf([
      ...header(1, 700),
      ...row(1, 690, '01/10/26', 'חנות א', '₪ 10.00'), // currency mark in the charge cell
      ...row(1, 680, '02/10/26', 'חנות ב', 'n/a'), // unreadable charge: reported
      ...row(2, 780, '05/10/26', 'כותרת עמוד', '99.00'), // next page before its header: not a row
      ...header(2, 760),
      ...row(2, 750, '03/10/26', 'חנות ג', '20.00'),
      at(2, 700, 'מסגרת הכרטיס ותנאי האשראי', 520),
      ...header(2, 690), // credit terms look like a table: still not charges
      ...row(2, 680, '03/10/2026', 'יתרה', '1,500.00'),
    ]);
    expect(r.rows.map((x) => [x.description, x.amountMinor])).toEqual([
      ['חנות א', -1000],
      ['חנות ג', -2000],
    ]);
    expect(r.errors.map((e) => e.code)).toEqual(['amount_invalid']);
  });

  it('a PDF without a charges table gives no rows', () => {
    const line = (y: number, s: string, x = 100): PdfItem => ({ page: 1, x, y, w: 50, s, rtl: true });
    expect(parseCardPdf([line(700, 'שלום'), line(690, '01/10/26', 300), line(690, '12.00', 100)]).rows).toEqual([]);
  });
});
