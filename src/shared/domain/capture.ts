/** Purchases sent by a phone automation (Apple Pay "Transaction" trigger in iOS Shortcuts), D-R20. */
import { norm } from '../normalize';
import { issuerOf, type CardAccountIn } from './cards';

/**
 * The amount as Wallet formats it ("₪45.90", "45.90 ₪", "‏1,234.50 ש״ח", "$12.00", "12,50 €", or a plain
 * number) → positive minor units and whether it is in shekels. `currency` null = no symbol (taken as ILS).
 */
export function parsePaidAmount(v: unknown): { minor: number; currency: 'ILS' | 'foreign' | null } | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 1e9 ? { minor: Math.round(v * 100), currency: null } : null;
  if (typeof v !== 'string' || v.length > 40) return null;
  const s = v.replace(/[‎‏‪-‮⁦-⁩\s]/g, '');
  const ils = /₪|ש"?״?ח|ils|nis/i.test(s);
  const foreign = /[$€£¥]|usd|eur|gbp|chf|jpy/i.test(s);
  const num = s.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(num) || num.includes('-')) return null;
  const lastDot = num.lastIndexOf('.');
  const lastComma = num.lastIndexOf(',');
  let n: number;
  // the last separator is the decimal one when 1–2 digits follow it; otherwise separators group thousands
  const dec = Math.max(lastDot, lastComma);
  if (dec >= 0 && num.length - dec - 1 >= 1 && num.length - dec - 1 <= 2) n = Number(`${num.slice(0, dec).replace(/[.,]/g, '')}.${num.slice(dec + 1)}`);
  else n = Number(num.replace(/[.,]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n >= 1e9) return null;
  return { minor: Math.round(n * 100), currency: foreign && !ils ? 'foreign' : ils ? 'ILS' : null };
}

/**
 * The card account a Wallet card name belongs to: its last 4 digits, then the issuer in the name
 * ("Max", "Isracard", "American Express"), then the account's own name, then the only card account.
 */
export function matchCaptureCard(cardName: string | null | undefined, accounts: (CardAccountIn & { name: string })[]): string | null {
  if (!accounts.length) return null;
  const n = norm(cardName ?? '');
  if (n) {
    const digits: string[] = n.match(/\d{4}/g) ?? [];
    const byMask = accounts.filter((a) => !!a.mask && digits.includes(a.mask));
    if (byMask.length === 1) return byMask[0]!.id;
    const issuer = issuerOf(n);
    const byIssuer = issuer ? accounts.filter((a) => a.bankId === issuer || (issuer === 'amex' && a.bankId === 'isracard' && !accounts.some((x) => x.bankId === 'amex'))) : [];
    if (byIssuer.length === 1) return byIssuer[0]!.id;
    const byName = accounts.filter((a) => norm(a.name) && (n.includes(norm(a.name)) || norm(a.name).includes(n)));
    if (byName.length === 1) return byName[0]!.id;
  }
  return accounts.length === 1 ? accounts[0]!.id : null;
}
