import { useTranslation } from 'react-i18next';
import { formatMoney, formatPercent, type Locale } from '../../shared/money';
import { formatDate } from '../components/DateText';
import { useCurrency } from './session';

/** Unicode-isolated so numbers never reorder inside RTL sentences. */
export const iso = (s: string) => `⁨${s}⁩`;

/** Formats language-neutral params (…Minor, pct, date, month) for i18n interpolation. */
export function useParamFormatter() {
  const { i18n } = useTranslation();
  const currency = useCurrency();
  const loc = i18n.language as Locale;
  return (params: Record<string, string | number>) => {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k.endsWith('Minor') && typeof v === 'number') out[k.replace(/Minor$/, '')] = iso(formatMoney(v, { currency, locale: loc, decimals: 0 }));
      else if (k === 'pct' && typeof v === 'number') out[k] = iso(formatPercent(v, loc));
      else if (k === 'date' && typeof v === 'string') out[k] = iso(formatDate(v, 'dayMonth', loc));
      else if (k === 'month' && typeof v === 'string') out[k] = formatDate(v, 'month', loc);
      else out[k] = typeof v === 'string' ? iso(v) : v;
    }
    return out;
  };
}
