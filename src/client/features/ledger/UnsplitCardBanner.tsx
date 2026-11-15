import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CreditCard } from 'lucide-react';
import { useBudget } from '../budget/useBudget';
import { formatMoney, type Locale } from '../../../shared/money';
import { useCurrency } from '../../lib/session';
import { monthEnd, monthStart } from '../../../shared/dates';

/** AC5.5: unsplit card charges in the month, linking to the split flow. */
export function UnsplitCardBanner({ month, hideLink }: { month: string; hideLink?: boolean }) {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const q = useBudget(month);
  const amount = q.data?.unsplitCardMinor ?? 0;
  if (!amount) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-3 text-sm" data-testid="unsplit-banner" data-amount={amount}>
      <CreditCard className="size-5 shrink-0 text-accent" aria-hidden />
      <span className="flex-1">{t('budget.unsplitBanner', { amount: formatMoney(amount, { currency, locale: i18n.language as Locale, decimals: 0 }) })}</span>
      {!hideLink && (
        <Link to={`/transactions?from=${monthStart(month)}&to=${monthEnd(month)}&kind=card_lump`} className="min-h-11 shrink-0 content-center rounded-lg px-2 font-semibold text-accent" data-testid="unsplit-cta">
          {t('budget.unsplitCta')}
        </Link>
      )}
    </div>
  );
}
