// Synthetic fixtures (invented data) for the known Israeli bank / card layouts in src/shared/import/formats.ts.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { sniffFile } from '../../src/shared/import/sniff';
import { toGrid } from '../../src/shared/import/grid';
import { pickParser } from '../../src/shared/import/registry';
import { findProfile, guessMapping, headerSignature, mappingValid, parseWithMapping, type Mapping } from '../../src/shared/import/generic';
import { dedupeKey } from '../../src/shared/import/dedupe';
import { FORMAT_PARSERS, PARSER_IDS } from '../../src/shared/import/formats';
import { decideParse, type Parsed } from '../../src/client/features/import/parseFile';
import { BANKS, bankUrl, inferAccount } from '../../src/shared/banks';
import type { Cell } from '../../src/shared/import/types';

/** aoa → real .xlsx bytes → sniff → grid, like a browser upload. */
function grid(aoa: Cell[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  const bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  const s = sniffFile('f.xlsx', bytes.length, bytes);
  if (!s.ok) throw new Error(s.error);
  return toGrid(s.kind, bytes);
}

const CASES: { id: string; card?: boolean; aoa: Cell[][]; amounts: number[]; descriptions: string[]; mask?: string; closing?: number }[] = [
  {
    id: 'hapoalim',
    aoa: [
      ['תנועות בחשבון'],
      ['מספר חשבון 12-345-678901'],
      [],
      ['תאריך', 'הפעולה', 'פרטים', 'אסמכתא', 'חובה', 'זכות', "יתרה בש''ח", 'תאריך ערך'],
      ['01/10/2026', 'משכורת', null, '1001', null, 10000, 15000, '01/10/2026'],
      ['03/10/2026', 'כרטיס דביט', 'סופר', '1002', 250.5, null, 14749.5, '03/10/2026'],
      ['05/10/2026', 'העברה', null, '1003', 1000, null, 13749.5, '05/10/2026'],
    ],
    amounts: [1000000, -25050, -100000],
    descriptions: ['משכורת', 'כרטיס דביט', 'העברה'],
    mask: '8901',
    closing: 1374950,
  },
  {
    id: 'leumi',
    aoa: [
      ['בנק לאומי'],
      ["מס' חשבון : 800-55512/34"],
      [],
      ['תאריך', 'תאריך ערך', 'תיאור', 'אסמכתא', 'בחובה', 'בזכות', 'היתרה בש"ח', 'תאור מורחב'],
      ['02/10/26', '02/10/26', 'הוראת קבע חשמל', '77', '312.50', null, '4,687.50', null],
      ['04/10/26', '04/10/26', 'זיכוי ביטוח לאומי', '78', null, '173.00', '4,860.50', 'קצבת ילדים'],
    ],
    amounts: [-31250, 17300],
    descriptions: ['הוראת קבע חשמל', 'זיכוי ביטוח לאומי'],
    mask: '5512',
    closing: 486050,
  },
  {
    id: 'discount',
    aoa: [
      ['עובר ושב - תנועות'],
      [],
      ['תאריך', 'יום ערך', 'תיאור התנועה', '₪ זכות/חובה ', '₪ יתרה ', 'אסמכתה', 'עמלה', 'ערוץ ביצוע'],
      ['06/10/2026', '06/10/2026', 'משיכת מזומן', -200, 800, '5', null, 'כספומט'],
      ['07/10/2026', '07/10/2026', 'העברה מחשבון', 1500.25, 2300.25, '6', null, 'אינטרנט'],
    ],
    amounts: [-20000, 150025],
    descriptions: ['משיכת מזומן', 'העברה מחשבון'],
    closing: 230025,
  },
  {
    id: 'isracard',
    card: true,
    aoa: [
      ['פירוט עסקאות'],
      ['מסטרקארד - 4321'],
      ['עסקאות בארץ'],
      ['תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'מטבע מקור', 'סכום חיוב', 'מטבע לחיוב', "מס' שובר", 'פירוט נוסף'],
      ['01/10/2026', 'שופרסל דיל', 300, '₪', 300, '₪', '111', null],
      ['02/10/2026', 'סופר פארם', 1200, '₪', 400, '₪', '112', 'תשלום 1 מתוך 3'],
      [null, 'סך חיוב בש"ח:', null, null, 700, null, null, null],
      [],
      ['עסקאות בחו˝ל'],
      ['תאריך רכישה', 'תאריך חיוב', 'שם בית עסק', 'סכום מקורי', 'מטבע מקור', 'סכום חיוב', 'מטבע לחיוב'],
      ['03/10/2026', '10/11/2026', 'AMAZON', 20, '$', 75.2, '₪'],
    ],
    amounts: [-30000, -40000, -7520],
    descriptions: ['שופרסל דיל', 'סופר פארם', 'AMAZON'],
  },
  {
    id: 'max',
    card: true,
    aoa: [
      ['כל המשתמשים (1)'],
      ['10/2026'],
      ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', '4 ספרות אחרונות של כרטיס האשראי', 'סוג עסקה', 'סכום חיוב', 'מטבע חיוב', 'סכום עסקה מקורי', 'מטבע עסקה מקורי', 'תאריך חיוב', 'הערות'],
      ['04-10-2026', 'רמי לוי', 'מזון', '1111', 'רגילה', 245.9, '₪', 245.9, '₪', '10-11-2026', null],
      ['05-10-2026', 'זיכוי חנות', 'שונות', '1111', 'זיכוי', -50, '₪', -50, '₪', '10-11-2026', null],
    ],
    amounts: [-24590, 5000],
    descriptions: ['רמי לוי', 'זיכוי חנות'],
  },
  {
    id: 'cal',
    card: true,
    aoa: [
      ['פירוט עסקאות לכרטיס'],
      ['תאריך עסקה', 'שם בית העסק', 'סכום עסקה', 'סכום חיוב', 'סוג עסקה', 'ענף', 'הערות'],
      ['06/10/26', 'סונול', 180, 180, 'רגילה', 'דלק', null],
    ],
    amounts: [-18000],
    descriptions: ['סונול'],
  },
  {
    id: 'cal',
    card: true,
    aoa: [
      ['כרטיס: 9999'],
      ['תאריך עסקה', 'בית עסק', 'סכום העסקה', 'סכום החיוב', 'תאריך החיוב', 'פירוט'],
      ['07/10/2026', 'קפה', 32, 32, '02/11/2026', null],
    ],
    amounts: [-3200],
    descriptions: ['קפה'],
  },
];

describe('known bank / card layouts', () => {
  CASES.forEach((c, i) =>
    it(`${c.id} #${i}: detected and parsed`, () => {
      const g = grid(c.aoa);
      const p = pickParser(g);
      expect(p?.id).toBe(c.id);
      expect(!!p?.card).toBe(!!c.card);
      const r = p!.parse(g);
      expect(r.errors).toEqual([]);
      expect(r.parserId).toBe(c.id);
      expect(r.rows.map((x) => x.amountMinor)).toEqual(c.amounts);
      expect(r.rows.map((x) => x.description)).toEqual(c.descriptions);
      expect(r.warnings).not.toContain('balance_mismatch');
      if (c.mask) expect(r.accountMask).toBe(c.mask);
      if (c.closing !== undefined) expect(r.closingBalance?.minor).toBe(c.closing);
      expect(p!.bankIds!.every((id) => BANKS.some((b) => b.id === id))).toBe(true);
    }),
  );

  it('unverified (guessed) layouts are not auto-parsed: Mizrahi-like file goes to the Mapper, pre-filled', () => {
    const g = grid([
      ['פירוט תנועות'],
      ['תאריך', 'סוג תנועה', 'זכות', 'חובה', 'יתרה בש"ח', 'אסמכתא', 'תאריך ערך'],
      ['08/10/2026', 'שיק', null, '90.00', '910.00', '3', '08/10/2026'],
      ['09/10/2026', 'הפקדה', '50.00', null, '960.00', '4', '09/10/2026'],
    ]);
    expect(pickParser(g)).toBeNull();
    const m = guessMapping(g);
    expect(m.columns).toMatchObject({ date: 0, type: 1, credit: 2, debit: 3, balance: 4, reference: 5, valueDate: 6 });
    // no description column: the user points it at "סוג תנועה" in the Mapper
    expect(mappingValid(m)).toBe(false);
    const fixed = { ...m, columns: { ...m.columns, description: 1 } };
    expect(parseWithMapping(g, fixed).rows.map((x) => x.amountMinor)).toEqual([-9000, 5000]);
  });

  it('card layouts parse but the import route does not accept them', () => {
    const cards = FORMAT_PARSERS.filter((p) => p.card).map((p) => p.id);
    expect(cards).toEqual(['isracard', 'max', 'cal']);
    expect(PARSER_IDS.some((id) => cards.includes(id))).toBe(false);
    expect(PARSER_IDS).toContain('hapoalim');
  });

  it('a saved column mapping wins over format detection, so re-import dedupe keys do not change', () => {
    const g = grid([
      ['מספר חשבון 12-345-678901'],
      [],
      ['תאריך', 'הפעולה', 'פרטים', 'אסמכתא', 'חובה', 'זכות', "יתרה בש''ח", 'תאריך ערך'],
      ['01/10/2026', 'העברה', 'לבעל הבית', '1001', 3000, null, 7000, '01/10/2026'],
      ['02/10/2026', 'כרטיס דביט', 'סופר', '1002', 100, null, 6900, '02/10/2026'],
    ]);
    // what the Mapper saved before formats existed: description = פרטים, header found two rows lower
    const saved: Mapping = { headerRow: 0, columns: { date: 0, description: 2, reference: 3, debit: 4, credit: 5, balance: 6, valueDate: 7 }, dateFormat: 'dmy', negate: false };
    const before = parseWithMapping(g, { ...saved, headerRow: 2 }).rows.map(dedupeKey);
    const prof = findProfile(g, new Map([[headerSignature(g, 2), saved]]));
    expect(prof?.mapping.headerRow).toBe(2);
    expect(parseWithMapping(g, prof!.mapping).rows.map(dedupeKey)).toEqual(before);
    // the format parser alone would pick another description column, i.e. new keys → duplicates
    const p = pickParser(g)!;
    expect(p.parse(g).rows.map(dedupeKey)).not.toEqual(before);
    // decideParse (upload and preview account switch): account without profile → format result;
    // account with the saved mapping → that mapping, same keys as before
    const parsed: Parsed = { fileName: 'f.xlsx', fileHash: '', kind: 'xlsx', grid: g, parserId: p.id, bankIds: p.bankIds!, card: false, result: p.parse(g), guess: null, signature: null };
    expect('result' in decideParse(parsed, new Map())).toBe(true);
    const d = decideParse(parsed, new Map([[headerSignature(g, 2), saved]]));
    expect('mapping' in d && d.profileUsed).toBe(true);
    if ('mapping' in d) expect(parseWithMapping(g, d.mapping).rows.map(dedupeKey)).toEqual(before);
    // switching to an account without a profile while holding A's mapping: the format result, not A's mapping
    expect('result' in decideParse(parsed, new Map(), saved)).toBe(true);
  });

  it('account switch on a generic file: the new account saved mapping wins over the current one', () => {
    const g = grid([
      ['תאריך', 'פרטים', 'הערה', 'סכום'],
      ['01/10/2026', 'שכירות', 'אוקטובר', -3000],
    ]);
    const guess = guessMapping(g);
    const parsed: Parsed = { fileName: 'f.csv', fileHash: '', kind: 'csv', grid: g, parserId: 'generic', bankIds: [], card: false, result: null, guess, signature: headerSignature(g, 0) };
    const current: Mapping = { ...guess, columns: { ...guess.columns, description: 2 } }; // A's mapping
    const bSaved: Mapping = { ...guess, columns: { ...guess.columns, description: 1 } };
    const sig = headerSignature(g, 0);
    const forB = decideParse(parsed, new Map([[sig, bSaved]]), current);
    expect(forB).toEqual({ mapping: bSaved, signature: sig, profileUsed: true });
    // B has no profile: keep the user's current mapping (shown in the Mapper again, not committed blindly)
    expect(decideParse(parsed, new Map(), current)).toEqual({ mapping: current, signature: sig, profileUsed: false });
  });

  it('an unknown layout falls back to the generic mapper (debit/credit with currency suffix)', () => {
    const g = grid([
      ['תאריך', 'אסמכתא', 'תיאור פעולה', 'חובה (₪)', 'זכות (₪)', 'יתרה (₪)'],
      ['01/10/2026', '1', 'עמלה', 10, null, 90],
      ['02/10/2026', '2', 'הפקדה', null, 20, 110],
    ]);
    expect(pickParser(g)).toBeNull();
    const m = guessMapping(g);
    expect(mappingValid(m)).toBe(true);
    expect(parseWithMapping(g, m).rows.map((x) => x.amountMinor)).toEqual([-1000, 2000]);
  });
});

describe('bank catalog & account inference', () => {
  const accs = [
    { id: 'a', accountMask: '8901', bankId: 'hapoalim' },
    { id: 'b', accountMask: null, bankId: 'leumi' },
    { id: 'c', accountMask: null, bankId: null },
  ];
  it('account-number mask wins, then the only account of the detected bank', () => {
    expect(inferAccount(accs, { accountMask: '8901', bankIds: ['leumi'] })?.id).toBe('a');
    expect(inferAccount(accs, { accountMask: '0000', bankIds: ['leumi'] })?.id).toBe('b');
  });
  it('asks (null) when ambiguous; a single account needs no question', () => {
    expect(inferAccount(accs, { bankIds: ['discount'] })).toBeNull();
    expect(inferAccount(accs, {})).toBeNull();
    expect(inferAccount([...accs, { id: 'd', accountMask: null, bankId: 'leumi' }], { bankIds: ['leumi'] })).toBeNull();
    expect(inferAccount([accs[2]!], {})?.id).toBe('c');
  });
  it('never picks an account whose number contradicts the file', () => {
    expect(inferAccount([{ id: 'a', accountMask: '8901', bankId: null }], { accountMask: '1234' })).toBeNull();
    expect(inferAccount(accs, { accountMask: '1234', bankIds: ['hapoalim'] })).toBeNull();
    expect(inferAccount([{ id: 'a', accountMask: null, bankId: 'leumi' }], { accountMask: '1234', bankIds: ['leumi'] })?.id).toBe('a');
  });
  it('bankUrl', () => {
    expect(bankUrl({ bankId: 'leumi' })).toMatch(/^https:\/\//);
    expect(bankUrl({ bankId: null })).toBeNull();
    expect(bankUrl({ bankId: 'nope' })).toBeNull();
    expect(new Set(BANKS.map((b) => b.id)).size).toBe(BANKS.length);
  });
});
