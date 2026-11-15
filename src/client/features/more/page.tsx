import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ADMIN_ITEM, MORE_ITEMS } from '../../lib/nav';
import { useMe } from '../../lib/session';
import { PageHeader } from '../../components/ui';

export function Component() {
  const { t } = useTranslation();
  const me = useMe();
  const items = me?.user.isSuperAdmin ? [...MORE_ITEMS, ADMIN_ITEM] : MORE_ITEMS;
  return (
    <div>
      <PageHeader title={t('nav.more')} />
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((it) => (
          <li key={it.to}>
            <Link to={it.to} data-testid={it.testId} className="flex min-h-14 items-center gap-3 px-4 active:bg-surface-2">
              <it.icon className="size-5 text-accent" aria-hidden />
              <span className="flex-1 font-medium">{t(it.key)}</span>
              {it.to === '/review' && me?.badges.reviewDue && <span className="size-2 rounded-full bg-accent" data-testid="badge-review" role="img" aria-label={t('nav.reviewBadge')} />}
              <ChevronRight className="size-5 text-muted rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
