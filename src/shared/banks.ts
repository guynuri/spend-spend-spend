/** Israeli banks and card issuers. Badges are our own colored monograms, never the issuers' logos. */
export interface Bank {
  id: string;
  kind: 'bank' | 'card';
  he: string;
  en: string;
  url: string;
  color: string;
  mono: string;
}

export const BANKS = [
  { id: 'hapoalim', kind: 'bank', he: 'בנק הפועלים', en: 'Bank Hapoalim', url: 'https://www.bankhapoalim.co.il/', color: '#d71920', mono: 'פ' },
  { id: 'leumi', kind: 'bank', he: 'בנק לאומי', en: 'Bank Leumi', url: 'https://www.leumi.co.il/', color: '#0064b4', mono: 'ל' },
  { id: 'discount', kind: 'bank', he: 'בנק דיסקונט', en: 'Discount Bank', url: 'https://www.discountbank.co.il/', color: '#5f9c2f', mono: 'ד' },
  { id: 'mizrahi', kind: 'bank', he: 'מזרחי טפחות', en: 'Mizrahi-Tefahot', url: 'https://www.mizrahi-tefahot.co.il/', color: '#e86b1f', mono: 'מ' },
  { id: 'fibi', kind: 'bank', he: 'הבנק הבינלאומי', en: 'First International (FIBI)', url: 'https://www.fibi.co.il/', color: '#1d3f75', mono: 'ב' },
  { id: 'otsar', kind: 'bank', he: 'בנק אוצר החייל', en: 'Otsar Ha-Hayal', url: 'https://www.bankotsar.co.il/', color: '#2a5c9a', mono: 'או' },
  { id: 'massad', kind: 'bank', he: 'בנק מסד', en: 'Bank Massad', url: 'https://www.bankmassad.co.il/', color: '#7a2f8f', mono: 'מס' },
  { id: 'mercantile', kind: 'bank', he: 'בנק מרכנתיל', en: 'Mercantile Bank', url: 'https://www.mercantile.co.il/', color: '#00818a', mono: 'מר' },
  { id: 'yahav', kind: 'bank', he: 'בנק יהב', en: 'Bank Yahav', url: 'https://www.bank-yahav.co.il/', color: '#b8860b', mono: 'יה' },
  { id: 'jerusalem', kind: 'bank', he: 'בנק ירושלים', en: 'Bank of Jerusalem', url: 'https://www.bankjerusalem.co.il/', color: '#8c1d40', mono: 'יר' },
  { id: 'onezero', kind: 'bank', he: 'וואן זירו', en: 'One Zero', url: 'https://www.onezerobank.com/', color: '#222222', mono: '01' },
  { id: 'pepper', kind: 'bank', he: 'פפר', en: 'Pepper', url: 'https://www.pepper.co.il/', color: '#e4002b', mono: 'P' },
  { id: 'isracard', kind: 'card', he: 'ישראכרט', en: 'Isracard', url: 'https://digital.isracard.co.il/', color: '#1b4f9c', mono: 'יש' },
  { id: 'max', kind: 'card', he: 'מקס', en: 'Max', url: 'https://www.max.co.il/', color: '#e6007e', mono: 'M' },
  { id: 'cal', kind: 'card', he: 'כאל', en: 'Cal (Visa Cal)', url: 'https://www.cal-online.co.il/', color: '#00a0df', mono: 'כ' },
  { id: 'amex', kind: 'card', he: 'אמריקן אקספרס', en: 'American Express IL', url: 'https://he.americanexpress.co.il/', color: '#2e77bb', mono: 'AX' },
] as const satisfies readonly Bank[];

export type BankId = (typeof BANKS)[number]['id'];
export const BANK_IDS = BANKS.map((b) => b.id) as [BankId, ...BankId[]];
const BY_ID = new Map<string, Bank>(BANKS.map((b) => [b.id, b]));
export const bankById = (id: string | null | undefined): Bank | null => (id ? (BY_ID.get(id) ?? null) : null);

/** The bank's website for an account with a catalog bank, else null. */
export const bankUrl = (account: { bankId?: string | null }): string | null => bankById(account.bankId)?.url ?? null;

interface InferAccount {
  id: string;
  accountMask: string | null;
  bankId?: string | null;
}
/**
 * Which account a file belongs to: the account-number mask, else the only account of the detected
 * bank, else the only account. null = ask the user.
 */
export function inferAccount<A extends InferAccount>(accounts: A[], file: { accountMask?: string | null; bankIds?: readonly string[] }): A | null {
  const fm = file.accountMask;
  if (fm) {
    const hit = accounts.filter((a) => a.accountMask === fm);
    if (hit.length === 1) return hit[0]!;
  }
  // never guess an account whose own number contradicts the file's
  const ok = (a: A | undefined) => (a && (!fm || !a.accountMask || a.accountMask === fm) ? a : null);
  if (file.bankIds?.length) {
    const hit = accounts.filter((a) => a.bankId && file.bankIds!.includes(a.bankId));
    if (hit.length === 1) return ok(hit[0]);
  }
  return accounts.length === 1 ? ok(accounts[0]) : null;
}
