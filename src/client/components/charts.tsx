/** Chart helpers. Recharts is imported only from lazy route modules. */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Locale } from '../../shared/money';
import { useCurrency } from '../lib/session';

export const C = {
  accent: 'var(--mz-chart-1)',
  muted: 'var(--mz-chart-2)',
  bad: 'var(--mz-chart-3)',
  good: 'var(--mz-good)',
  warn: 'var(--mz-warn)',
  grid: 'var(--mz-border)',
  text: 'var(--mz-muted)',
};

export function useMoneyFmt(decimals: 0 | 2 = 0) {
  const { i18n } = useTranslation();
  const currency = useCurrency();
  return (minor: number) => formatMoney(minor, { currency, locale: i18n.language as Locale, decimals });
}
export function useCompactMoney() {
  const { i18n } = useTranslation();
  const currency = useCurrency();
  const nf = new Intl.NumberFormat(i18n.language === 'he' ? 'he-IL' : 'en-IL', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  return (minor: number) => nf.format(minor / 100);
}

/** Time axes run oldest → newest left to right in both locales (PLAN §12). */
export function ChartBox({ height = 220, children, label }: { height?: number; children: ReactNode; label: string }) {
  return (
    <div dir="ltr" role="img" aria-label={label} style={{ width: '100%', height }} className="text-xs">
      {children}
    </div>
  );
}

export const tooltipStyle = (rtl: boolean) => ({
  contentStyle: { background: 'var(--mz-surface)', border: '1px solid var(--mz-border)', borderRadius: 12, direction: rtl ? ('rtl' as const) : ('ltr' as const), color: 'var(--mz-text)' },
  labelStyle: { color: 'var(--mz-muted)' },
});
