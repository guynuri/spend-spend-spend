/** Money is always signed integer minor units (agorot). Income positive, spending negative. */
export type Minor = number;
export type Locale = 'en' | 'he';

export const intlLocale = (l: Locale): string => (l === 'he' ? 'he-IL' : 'en-IL');

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(locale: Locale, currency: string, decimals: number, signDisplay: Intl.NumberFormatOptions['signDisplay']) {
  const k = `${locale}|${currency}|${decimals}|${signDisplay}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      signDisplay,
    });
    fmtCache.set(k, f);
  }
  return f;
}

export function formatMoney(
  minor: Minor,
  opts: { currency?: string; locale?: Locale; decimals?: 0 | 2; signed?: boolean } = {},
): string {
  const { currency = 'ILS', locale = 'en', decimals = 2, signed = false } = opts;
  const value = decimals === 0 ? Math.round(minor / 100) : minor / 100;
  return nf(locale, currency, decimals, signed ? 'exceptZero' : 'auto').format(value === 0 ? 0 : value);
}

export function formatPercent(ratio: number, locale: Locale = 'en', digits = 0): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(ratio);
}

/** Parse a user-typed amount ("1,234.50", "₪ 99", "-12") into minor units. Null if invalid. */
export function parseMoneyInput(input: string): Minor | null {
  const s = input.replace(/[₪\s,]/g, '').replace(/[‎‏]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const minor = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor)) return null;
  return neg ? -minor : minor;
}

/** Minor units → plain decimal string for inputs ("1234.5" → "1234.50"). */
export function minorToInput(minor: Minor): string {
  const neg = minor < 0;
  const a = Math.abs(minor);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

export function roundToStep(minor: Minor, stepMinor: Minor): Minor {
  return Math.round(minor / stepMinor) * stepMinor;
}

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
