import { ArrowLeftRight, CalendarClock, ChartLine, ClipboardCheck, Home, Landmark, LayoutGrid, PiggyBank, Repeat, Settings, Shield, Target, TrendingUp, Upload, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  key: string;
  tabKey?: string;
  icon: LucideIcon;
  testId: string;
}

export const TAB_ITEMS: NavItem[] = [
  { to: '/', key: 'nav.overview', icon: Home, testId: 'tab-overview' },
  { to: '/transactions', key: 'nav.transactions', icon: ArrowLeftRight, testId: 'tab-transactions' },
  { to: '/budget', key: 'nav.budget', icon: PiggyBank, testId: 'tab-budget' },
  { to: '/upcoming', key: 'nav.upcoming', tabKey: 'nav.upcomingTab', icon: CalendarClock, testId: 'tab-upcoming' },
  { to: '/more', key: 'nav.more', icon: LayoutGrid, testId: 'tab-more' },
];

export const MORE_ITEMS: NavItem[] = [
  { to: '/forecast', key: 'nav.forecast', icon: ChartLine, testId: 'nav-forecast' },
  { to: '/recurring', key: 'nav.recurring', icon: Repeat, testId: 'nav-recurring' },
  { to: '/accounts', key: 'nav.accounts', icon: Landmark, testId: 'nav-accounts' },
  { to: '/goals', key: 'nav.goals', icon: Target, testId: 'nav-goals' },
  { to: '/trends', key: 'nav.trends', icon: TrendingUp, testId: 'nav-trends' },
  { to: '/review', key: 'nav.review', icon: ClipboardCheck, testId: 'nav-review' },
  { to: '/import', key: 'nav.import', icon: Upload, testId: 'nav-import' },
  { to: '/household', key: 'nav.household', icon: Users, testId: 'nav-household' },
  { to: '/settings', key: 'nav.settings', icon: Settings, testId: 'nav-settings' },
];

export const ADMIN_ITEM: NavItem = { to: '/admin', key: 'nav.admin', icon: Shield, testId: 'nav-admin' };
export const SIDEBAR_ITEMS: NavItem[] = [...TAB_ITEMS.filter((i) => i.to !== '/more'), ...MORE_ITEMS];
