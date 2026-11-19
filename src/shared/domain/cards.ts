/**
 * Credit-card accounts (D-R20). Purchases live on a card account (card files, Apple Pay captures, manual
 * entries); the bank's monthly card charge is then the bill payment — a transfer, not spending — except
 * for the part no known purchase explains ("not itemized yet"), which still counts as spending.
 */
import { norm } from '../normalize';
import { addMonths, monthOf, type MonthStr } from '../dates';

export type CardIssuer = 'isracard' | 'amex' | 'max' | 'cal';
export const CARD_ISSUERS: readonly CardIssuer[] = ['isracard', 'amex', 'max', 'cal'];

/** Words in a bank's card-charge description that name the issuer (normalized like description_norm). */
const ISSUER_WORDS: Record<CardIssuer, string[]> = {
  isracard: ['ישראכרט', 'isracard', 'מסטרקארד', 'mastercard'],
  amex: ['אמריקן אקספרס', 'אמריקן', 'amex', 'american express'],
  max: ['מקס', 'max it', 'max', 'לאומי קארד', 'leumi card'],
  cal: ['כאל', 'cal', 'כרטיסי אשראי לישראל', 'דיינרס', 'diners'],
};
const LETTER = 'a-z0-9\\u0590-\\u05ff';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Card network names: Max and Cal issue Mastercards too, so these only count when no issuer is named. */
const NETWORK_WORDS = new Set(['מסטרקארד', 'mastercard']);
const WORDS = Object.entries(ISSUER_WORDS)
  .flatMap(([k, ws]) => ws.map((w) => ({ issuer: k as CardIssuer, network: NETWORK_WORDS.has(w), re: new RegExp(`(^|[^${LETTER}])${escapeRe(norm(w))}([^${LETTER}]|$)`) })))
  .sort((a, b) => Number(a.network) - Number(b.network));

/** The issuer a card charge names, or null (e.g. a bare "visa"). */
export function issuerOf(descriptionNorm: string): CardIssuer | null {
  for (const w of WORDS) if (w.re.test(descriptionNorm)) return w.issuer;
  return null;
}

/** Isracard operates American Express in Israel: a charge from either may be either card's bill. */
const group = (i: CardIssuer) => (i === 'amex' ? 'isracard' : i);

export interface CardAccountIn {
  id: string;
  bankId: string | null;
  mask: string | null;
}

/**
 * Which card account a bank card charge pays:
 * 1. accounts of the issuer named in the description (Isracard and Amex count as one group; when none
 *    has that issuer, the card accounts with no issuer set), or all card accounts when it names none;
 * 2. among several, those whose last 4 digits appear in the description;
 * 3. still several: the one whose purchases in the previous month come closest to the charge, within 10 %.
 * Null when nothing fits (the charge stays "not split" until the user links it).
 */
export function chooseCardAccount(lump: { descriptionNorm: string; amountMinor: number; date: string }, accounts: CardAccountIn[], coveredIn: (accountId: string, month: MonthStr) => number): string | null {
  const issuer = issuerOf(lump.descriptionNorm);
  let c = issuer ? accounts.filter((a) => a.bankId && (CARD_ISSUERS as readonly string[]).includes(a.bankId) && group(a.bankId as CardIssuer) === group(issuer)) : accounts;
  // no account of that issuer: card accounts without a known issuer may still be it (never another issuer's)
  if (issuer && !c.length) c = accounts.filter((a) => !a.bankId || !(CARD_ISSUERS as readonly string[]).includes(a.bankId));
  if (c.length > 1) {
    const byMask = c.filter((a) => a.mask && a.mask.length >= 3 && lump.descriptionNorm.includes(a.mask));
    if (byMask.length) c = byMask;
  }
  if (c.length === 1) return c[0]!.id;
  if (!c.length) return null;
  const amount = Math.abs(lump.amountMinor);
  const prev = cycleMonth(lump.date);
  const scored = c.map((a) => ({ id: a.id, d: Math.abs(coveredIn(a.id, prev) - amount) })).sort((x, y) => x.d - y.d);
  return scored[0]!.d <= amount * 0.1 && (scored.length < 2 || scored[1]!.d > scored[0]!.d) ? scored[0]!.id : null;
}

/** Purchases a charge on date D pays: the calendar month before D's month (the usual Israeli billing cycle). */
export const cycleMonth = (chargeDate: string): MonthStr => addMonths(monthOf(chargeDate), -1);

/**
 * How a linked charge is booked: `paidMinor` is the bill payment (a transfer), `unitemizedMinor` the part
 * no purchase on the card account explains yet, still counted as spending. Both positive; they add up to the charge.
 */
export function cardPaymentParts(chargeMinor: number, coveredMinor: number): { paidMinor: number; unitemizedMinor: number } {
  const a = Math.abs(chargeMinor);
  const unitemizedMinor = Math.max(0, Math.min(a, a - Math.max(0, coveredMinor)));
  return { paidMinor: a - unitemizedMinor, unitemizedMinor };
}
