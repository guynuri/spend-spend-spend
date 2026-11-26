import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { cardPaymentParts, chooseCardAccount, cycleMonth, issuerOf } from '../../src/shared/domain/cards';
import { isNameOnly, matchCaptureCard, parsePaidAmount, readPurchase } from '../../src/shared/domain/capture';
import { cardAccountResult, installmentOf } from '../../src/shared/import/cardAccount';
import { pickParser } from '../../src/shared/import/registry';
import { sniffFile } from '../../src/shared/import/sniff';
import { toGrid } from '../../src/shared/import/grid';
import { norm } from '../../src/shared/normalize';
import type { Cell } from '../../src/shared/import/types';

function grid(aoa: Cell[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  const bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  const s = sniffFile('f.xlsx', bytes.length, bytes);
  if (!s.ok) throw new Error(s.error);
  return toGrid(s.kind, bytes);
}

describe('card charges → card accounts', () => {
  it('names the issuer of a bank card charge', () => {
    expect(issuerOf(norm('ישראכרט חיוב חודשי'))).toBe('isracard');
    expect(issuerOf(norm('מקס איט פיננסים'))).toBe('max');
    expect(issuerOf(norm('לאומי קארד'))).toBe('max');
    expect(issuerOf(norm('כאל - כרטיסי אשראי'))).toBe('cal');
    expect(issuerOf(norm('אמריקן אקספרס'))).toBe('amex');
    expect(issuerOf(norm('ויזה'))).toBeNull();
  });

  it('chooses the card account: issuer (Isracard ~ Amex), then last digits, then the closest purchases', () => {
    const accs = [
      { id: 'max', bankId: 'max', mask: '1111' },
      { id: 'isr', bankId: 'isracard', mask: '2222' },
      { id: 'amx', bankId: 'amex', mask: '3333' },
    ];
    const none = () => 0;
    const lump = (d: string, a = -100000) => ({ descriptionNorm: norm(d), amountMinor: a, date: '2026-11-10' });
    expect(chooseCardAccount(lump('מקס איט'), accs, none)).toBe('max');
    expect(chooseCardAccount(lump('ישראכרט 3333'), accs, none)).toBe('amx');
    // Isracard group, no digits: the account whose October purchases come closest (within 10 %)
    const cov = (a: string, m: string) => (m === '2026-10' ? ({ isr: 98000, amx: 40000 } as Record<string, number>)[a] ?? 0 : 0);
    expect(chooseCardAccount(lump('ישראכרט'), accs, cov)).toBe('isr');
    expect(chooseCardAccount(lump('ישראכרט'), accs, none)).toBeNull(); // nothing to tell them apart
    expect(chooseCardAccount(lump('ויזה'), [accs[0]!], none)).toBe('max'); // the only card account
    expect(cycleMonth('2026-01-02')).toBe('2025-12');
  });

  it('books a charge as bill payment plus the part no purchase explains', () => {
    expect(cardPaymentParts(-100000, 100000)).toEqual({ paidMinor: 100000, unitemizedMinor: 0 });
    expect(cardPaymentParts(-100000, 120000)).toEqual({ paidMinor: 100000, unitemizedMinor: 0 });
    expect(cardPaymentParts(-100000, 30000)).toEqual({ paidMinor: 30000, unitemizedMinor: 70000 });
    expect(cardPaymentParts(-100000, -5000)).toEqual({ paidMinor: 0, unitemizedMinor: 100000 });
  });
});

describe('Apple Pay captures', () => {
  it('reads Wallet amounts', () => {
    expect(parsePaidAmount('₪45.90')).toEqual({ minor: 4590, currency: 'ILS' });
    expect(parsePaidAmount('‏1,234.50 ₪')).toEqual({ minor: 123450, currency: 'ILS' });
    expect(parsePaidAmount('12,50 €')).toEqual({ minor: 1250, currency: 'foreign' });
    expect(parsePaidAmount('$1,200')).toEqual({ minor: 120000, currency: 'foreign' });
    expect(parsePaidAmount('88 ש״ח')).toEqual({ minor: 8800, currency: 'ILS' });
    expect(parsePaidAmount(19.9)).toEqual({ minor: 1990, currency: null });
    expect(parsePaidAmount('free')).toBeNull();
    expect(parsePaidAmount('-5')).toBeNull();
  });
  it('matches the Wallet card to a card account', () => {
    const accs = [
      { id: 'max', name: 'Max', bankId: 'max', mask: '1111' },
      { id: 'isr', name: 'Bank card', bankId: 'isracard', mask: null },
      { id: 'amx', name: 'Amex', bankId: 'amex', mask: '3333' },
    ];
    expect(matchCaptureCard('Max Visa •••• 1111', accs)).toBe('max');
    expect(matchCaptureCard('•••• 3333', accs)).toBe('amx');
    expect(matchCaptureCard('Isracard Mastercard', accs)).toBe('isr');
    expect(matchCaptureCard('American Express', accs)).toBe('amx');
    expect(matchCaptureCard('Bank card', accs)).toBe('isr');
    expect(matchCaptureCard('Unknown', accs)).toBeNull();
    expect(matchCaptureCard(null, [accs[0]!])).toBe('max');
  });
});

describe('card files into a card account', () => {
  const isracard = [
    ['פירוט עסקאות'],
    ['תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'מטבע מקור', 'סכום חיוב', 'מטבע לחיוב', "מס' שובר", 'פירוט נוסף'],
    ['01/10/2026', 'שופרסל דיל', 300, '₪', 300, '₪', '111', null],
    ['02/09/2026', 'סופר פארם', 1200, '₪', 400, '₪', '112', 'תשלום 2 מתוך 3'],
    ['20/10/2026', 'קפה', 32, '₪', null, null, '113', null], // not billed yet, in shekels
    ['21/10/2026', 'AMAZON', 20, '$', null, null, '114', null], // not billed yet, foreign: waits
  ] as Cell[][];
  it('keeps unbilled shekel purchases, dates installment k by month, leaves foreign unbilled rows out', () => {
    const g = grid(isracard);
    const p = pickParser(g)!;
    expect(p.card).toBe(true);
    const r = cardAccountResult(p.parse(g), g);
    expect(r.unbilled).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.date, x.amountMinor, x.description, x.reference])).toEqual([
      ['2026-10-01', -30000, 'שופרסל דיל', '111'],
      ['2026-10-02', -40000, 'סופר פארם', '112 2/3'],
      ['2026-10-20', -3200, 'קפה', '113'],
    ]);
  });
  it('finds installments outside the description', () => {
    expect(installmentOf(['x', 'תשלום 3 מתוך 12'], 0)).toEqual({ k: 3, n: 12 });
    expect(installmentOf(['תשלום 3 מתוך 12'], 0)).toBeNull();
    expect(installmentOf(['x', '2 מתוך 6'])).toEqual({ k: 2, n: 6 });
    expect(installmentOf(['x', 'רגילה'])).toBeNull();
  });
});

describe('reading a purchase from a shortcut, whatever its shape (D-R21)', () => {
  it('our own JSON, Wallet dictionaries, nested, "Key: value" lines and plain text', () => {
    expect(readPurchase('{"merchant":"Shufersal","amount":"₪45.90","card":"Max"}')).toEqual({ merchant: 'Shufersal', amount: '₪45.90', card: 'Max', date: null });
    expect(readPurchase({ Merchant: 'Cafe', Amount: '₪12.00', 'Card or Pass': 'Max •••• 1111', Name: 'Max' })).toEqual({ merchant: 'Cafe', amount: '₪12.00', card: 'Max •••• 1111', date: null });
    expect(readPurchase({ transaction: { merchant: 'Cafe', amount: 12 } })).toMatchObject({ merchant: 'Cafe', amount: 12 });
    expect(readPurchase('Merchant: Cafe Nero\nAmount: ₪18.50\nCard or Pass: Isracard')).toEqual({ merchant: 'Cafe Nero', amount: '₪18.50', card: 'Isracard', date: null });
    expect(readPurchase('Cafe Nero ₪18.50')).toMatchObject({ merchant: 'Cafe Nero', amount: '₪18.50' });
    expect(readPurchase([{ merchant: 'A', amount: 1 }])).toMatchObject({ merchant: 'A' });
    expect(readPurchase('')).toBeNull();
    expect(readPurchase('hello')).toBeNull();
    expect(readPurchase({ foo: 1 })).toBeNull();
    expect(readPurchase({ merchant: 'A', amount: 1, date: 'yesterday' })!.date).toBeNull();
    // an empty merchant is refused, not pieced together from the card name
    expect(readPurchase({ Merchant: '', Amount: '₪18.00', 'Card or Pass': 'Max •••• 1111' })).toBeNull();
    // a bare "Name" (the card's) doesn't beat "Merchant"
    expect(readPurchase({ Name: 'Max •••• 1111', Merchant: 'Cafe', Amount: '₪18' })).toMatchObject({ merchant: 'Cafe' });
    // digits in the merchant aren't the amount
    expect(readPurchase('7-Eleven ₪12.00')).toMatchObject({ merchant: '7-Eleven', amount: '₪12.00' });
    expect(readPurchase('Cafe 22 $18.50')).toMatchObject({ amount: '$18.50' });
    // form fields, and JSON longer than the plain-text limit
    expect(readPurchase('merchant=Cafe&amount=12')).toMatchObject({ merchant: 'Cafe', amount: '12' });
    expect(readPurchase(JSON.stringify({ merchant: 'Cafe', amount: '₪12', note: 'x'.repeat(2100) }))).toMatchObject({ merchant: 'Cafe' });
  });
});

describe('a name without an amount (Wallet transaction passed on as is)', () => {
  it('is a plain name, even with digits in it; never fields, JSON, form or text with an amount', () => {
    for (const s of ['Aroma Tel Aviv', '7-Eleven', 'Super-Pharm 24', 'ארומה']) expect(isNameOnly(s), s).toBe(true);
    for (const s of ['', 'Aroma ₪18', 'Cafe 12.50', '88 ש״ח', 'Merchant: Aroma\nAmount: \nCard or Pass: Max', 'סוחר: ארומה', '{"merchant":"x"}', 'merchant=x&amount=1'])
      expect(isNameOnly(s), s).toBe(false);
  });
});
