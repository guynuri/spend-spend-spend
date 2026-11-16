import { useTranslation } from 'react-i18next';
import { formatMoney, toneSign, type Locale, type MoneyTone } from '../../shared/money';
import { useCurrency } from '../lib/session';
import { cx } from './ui';

/** The only way to print an amount (PLAN §12). */
export function Money({ minor, decimals = 2, signed, className, tone }: { minor: number | null | undefined; decimals?: 0 | 2; signed?: boolean; className?: string; tone?: MoneyTone }) {
  const { i18n } = useTranslation();
  const currency = useCurrency();
  if (minor === null || minor === undefined) return <bdi className={cx('tabular', className)}>—</bdi>;
  const text = formatMoney(minor, { currency, locale: i18n.language as Locale, decimals, signed });
  return (
    <bdi className={cx('tabular whitespace-nowrap', { [-1]: 'text-bad', 0: '', 1: 'text-good' }[toneSign(minor, tone)], className)} data-minor={minor}>
      {text}
    </bdi>
  );
}
