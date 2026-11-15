import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { bankById, bankUrl } from '../../shared/banks';
import { cx } from './ui';

/** Bank name in the UI language: catalog name, else the free-text institution. */
export function useBankName() {
  const { i18n } = useTranslation();
  return (a: { bankId?: string | null; institution?: string | null }) => {
    const b = bankById(a.bankId);
    return b ? (i18n.language === 'he' ? b.he : b.en) : a.institution || null;
  };
}

/** Colored monogram badge (our own drawing, not the bank's logo). Free-text banks get a neutral initial. */
export function BankBadge({ bankId, institution, size = 'sm' }: { bankId?: string | null; institution?: string | null; size?: 'sm' | 'md' }) {
  const b = bankById(bankId);
  const mono = b?.mono ?? institution?.trim().slice(0, 1);
  if (!mono) return null;
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-bold leading-none text-white', size === 'md' ? 'size-9 text-sm' : 'size-6 text-[0.65rem]', !b && 'bg-muted')}
      style={b ? { backgroundColor: b.color } : undefined}
    >
      {mono}
    </span>
  );
}

/** "Open bank website" link for an account with a catalog bank; nothing otherwise. */
export function BankLink({ account, className }: { account: { bankId?: string | null }; className?: string }) {
  const { t } = useTranslation();
  const url = bankUrl(account);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cx('inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline', className)} data-testid="bank-link">
      <ExternalLink className="size-4" aria-hidden />
      {t('accounts.openBank')}
    </a>
  );
}
