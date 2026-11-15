import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ADMIN_ITEM, PAGE_ITEMS, navSlug } from '../../lib/nav';
import { useNavTabs } from '../../lib/prefs';
import { Badge } from '../../components/Layout';
import { useMe } from '../../lib/session';
import { PageHeader } from '../../components/ui';

export function Component() {
  const { t } = useTranslation();
  const me = useMe();
  const [tabs] = useNavTabs();
  const rest = PAGE_ITEMS.filter((i) => !tabs.includes(i.to));
  const items = me?.user.isSuperAdmin ? [...rest, ADMIN_ITEM] : rest;
  return (
    <div>
      <PageHeader title={t('nav.more')} />
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {items.map((it) => (
          <li key={it.to}>
            <Link to={it.to} data-testid={`nav-${navSlug(it)}`} className="flex min-h-14 items-center gap-3 px-4 active:bg-surface-2">
              <it.icon className="size-5 text-accent" aria-hidden />
              <span className="flex-1 font-medium">{t(it.key)}</span>
              <Badge item={it} inline />
              <ChevronRight className="size-5 text-muted rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
