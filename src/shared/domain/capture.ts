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

export interface PurchaseIn {
  merchant: string;
  amount: string | number;
  card: string | null;
  date: string | null;
}

const MERCHANT_KEY = /^(merchant|merchant name|business|בית עסק|שם בית עסק|name|שם)$/;
const AMOUNT_KEY = /^(amount|price|total|סכום)$/;
const CARD_KEY = /^(card|card or pass|pass|card name|כרטיס|כרטיס או כרטיס|wallet card)$/;
const AMOUNT_IN_TEXT = /(?:[₪$€£]\s*)?\d[\d.,]*(?:\s*(?:₪|ש"?״?ח|ils|nis|usd|eur|\$|€|£))?/i;

/**
 * A purchase from a phone automation, in whatever shape the shortcut sent it (D-R21): our own JSON
 * ({ merchant, amount, card }), Wallet's transaction as a dictionary (Merchant / Amount / Card or Pass,
 * any case, possibly under "transaction"), "Key: value" lines, or plain text with an amount in it.
 * Null when no merchant and amount can be found.
 */
export function readPurchase(raw: unknown, depth = 0): PurchaseIn | null {
  if (depth > 3 || raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s.length > 2000) return null;
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        return readPurchase(JSON.parse(s), depth + 1);
      } catch {
        /* not JSON: read it as text */
      }
    }
    const lines = s.split(/\r?\n/).map((l) => /^\s*([^:]{1,30}):\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
    if (lines.length >= 2) return readPurchase(Object.fromEntries(lines.map((m) => [m[1]!, m[2]!])), depth + 1);
    const m = AMOUNT_IN_TEXT.exec(s);
    const merchant = m ? (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/^[\s,·:-]+|[\s,·:-]+$/g, '') : '';
    return m && merchant ? { merchant: merchant.slice(0, 300), amount: m[0], card: null, date: null } : null;
  }
  if (Array.isArray(raw)) return raw.length ? readPurchase(raw[0], depth + 1) : null;
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const pick = (re: RegExp) => Object.entries(o).find(([k]) => re.test(k.trim().toLowerCase()))?.[1];
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  const merchant = str(pick(MERCHANT_KEY));
  const amount = pick(AMOUNT_KEY);
  if (merchant && (typeof amount === 'string' || typeof amount === 'number')) {
    const date = str(pick(/^date$/));
    return { merchant: merchant.slice(0, 300), amount: typeof amount === 'string' ? amount.slice(0, 40) : amount, card: str(pick(CARD_KEY)).slice(0, 100) || null, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
  }
  // one level down: { transaction: {...} } or { "Shortcut Input": "..." }
  for (const v of Object.values(o)) {
    if (v && (typeof v === 'object' || typeof v === 'string')) {
      const r = readPurchase(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}
