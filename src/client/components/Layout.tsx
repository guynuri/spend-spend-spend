import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Suspense } from 'react';
import { ADMIN_ITEM, SIDEBAR_ITEMS, TAB_ITEMS, type NavItem } from '../lib/nav';
import { useMe } from '../lib/session';
import { cx, Spinner } from './ui';
import { InstallHint, OfflineBanner, UpdatePrompt } from './Pwa';
import { SampleDataBanner } from './SampleDataBanner';
import { TourProvider } from './Tour';

function Badge({ item }: { item: NavItem }) {
  const me = useMe();
  const { t } = useTranslation();
  if (item.to === '/transactions' && me?.badges.uncategorized)
    return (
      <span className="absolute -top-0.5 end-1 min-w-4 rounded-full bg-warn px-1 text-center text-[10px] font-bold leading-4 text-white lg:static lg:ms-auto" data-testid="badge-uncategorized" aria-label={t('nav.uncategorizedBadge', { count: me.badges.uncategorized })}>
        {me.badges.uncategorized > 99 ? '99+' : me.badges.uncategorized}
      </span>
    );
  if (item.to === '/budget' && me?.badges.overBudget)
    return <span className="absolute top-1 end-3 size-2 rounded-full bg-bad lg:static lg:ms-auto" data-testid="badge-over-budget" role="img" aria-label={t('nav.overBudgetBadge')} />;
  if ((item.to === '/review' || item.to === '/more') && me?.badges.reviewDue)
    return <span className="absolute top-1 end-3 size-2 rounded-full bg-accent lg:static lg:ms-auto" data-testid="badge-review" role="img" aria-label={t('nav.reviewBadge')} />;
  return null;
}

function Sidebar() {
  const { t } = useTranslation();
  const me = useMe();
  const items = me?.user.isSuperAdmin ? [...SIDEBAR_ITEMS, ADMIN_ITEM] : SIDEBAR_ITEMS;
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-e border-border bg-surface px-3 py-4 lg:flex" data-testid="sidebar">
      <div className="mb-4 px-3 text-xl font-bold text-accent">{t('app.name')}</div>
      {me?.active && <div className="mb-3 truncate px-3 text-sm text-muted">{me.active.name}</div>}
      <nav aria-label={t('nav.main')} className="flex flex-col gap-1 overflow-y-auto">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            data-testid={`side-${it.testId}`}
            className={({ isActive }) => cx('relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium', isActive ? 'bg-accent/12 text-accent' : 'text-text hover:bg-surface-2')}
          >
            <it.icon className="size-5 shrink-0" aria-hidden />
            <span className="truncate">{t(it.key)}</span>
            <Badge item={it} />
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function TabBar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const moreActive = !TAB_ITEMS.some((i) => i.to !== '/more' && (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));
  return (
    <nav
      aria-label={t('nav.main')}
      data-testid="tabbar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {TAB_ITEMS.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.to === '/'}
              data-testid={it.testId}
              className={({ isActive }) =>
                cx('relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium', (it.to === '/more' ? moreActive : isActive) ? 'text-accent' : 'text-muted')
              }
            >
              <it.icon className="size-6" aria-hidden />
              <span className="max-w-full truncate">{t(it.tabKey ?? it.key)}</span>
              <Badge item={it} />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Layout() {
  const me = useMe();
  return (
    <TourProvider>
    <div className="flex min-h-dvh bg-bg text-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <div className="flex min-h-12 items-center justify-between gap-2 px-4">
            <span className="text-lg font-bold text-accent"><AppName /></span>
            {me?.active && <span className="truncate text-sm text-muted" data-testid="household-name">{me.active.name}</span>}
          </div>
        </header>
        <OfflineBanner />
        <SampleDataBanner />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 lg:px-8 lg:pb-10" data-testid="app-root">
          <InstallHint />
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <TabBar />
      <UpdatePrompt />
    </div>
    </TourProvider>
  );
}

function AppName() {
  const { t } = useTranslation();
  return <>{t('app.name')}</>;
}
