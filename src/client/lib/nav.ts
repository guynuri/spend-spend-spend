import { ArrowLeftRight, Tags, CalendarClock, ChartLine, ClipboardCheck, Home, Landmark, LayoutGrid, PiggyBank, Repeat, Settings, Shield, Target, TrendingUp, Upload, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  key: string;
  tabKey?: string;
  icon: LucideIcon;
  testId: string;
}

/** Every page, in sidebar order. Phones show TAB_SLOTS of them in the bottom bar (user-chosen, see prefs.ts); the rest live under More. */
export const PAGE_ITEMS: NavItem[] = [
  { to: '/', key: 'nav.overview', icon: Home, testId: 'tab-overview' },
  { to: '/transactions', key: 'nav.transactions', icon: ArrowLeftRight, testId: 'tab-transactions' },
  { to: '/budget', key: 'nav.budget', icon: PiggyBank, testId: 'tab-budget' },
  { to: '/upcoming', key: 'nav.upcoming', tabKey: 'nav.upcomingTab', icon: CalendarClock, testId: 'tab-upcoming' },
  { to: '/forecast', key: 'nav.forecast', icon: ChartLine, testId: 'nav-forecast' },
  { to: '/recurring', key: 'nav.recurring', icon: Repeat, testId: 'nav-recurring' },
  { to: '/accounts', key: 'nav.accounts', icon: Landmark, testId: 'nav-accounts' },
  { to: '/categories', key: 'nav.categories', icon: Tags, testId: 'nav-categories' },
  { to: '/goals', key: 'nav.goals', icon: Target, testId: 'nav-goals' },
  { to: '/trends', key: 'nav.trends', icon: TrendingUp, testId: 'nav-trends' },
  { to: '/review', key: 'nav.review', icon: ClipboardCheck, testId: 'nav-review' },
  { to: '/import', key: 'nav.import', icon: Upload, testId: 'nav-import' },
  { to: '/household', key: 'nav.household', icon: Users, testId: 'nav-household' },
  { to: '/settings', key: 'nav.settings', icon: Settings, testId: 'nav-settings' },
];
export const MORE_ITEM: NavItem = { to: '/more', key: 'nav.more', icon: LayoutGrid, testId: 'tab-more' };
/** Bottom bar: [tab, tab, +, tab, More]. */
export const TAB_SLOTS = 3;
export const DEFAULT_TABS = ['/', '/transactions', '/budget'];
/** Where an item is rendered decides its testid prefix: `tab-*` in the bar, `nav-*` on the More page. */
export const navSlug = (it: NavItem) => it.testId.replace(/^(tab|nav)-/, '');

/** Parses a stored tab list; anything malformed falls back to the default. */
export function parseNavTabs(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (Array.isArray(v) && v.length === TAB_SLOTS && new Set(v).size === v.length && v.every((p) => PAGE_ITEMS.some((i) => i.to === p))) return v as string[];
  } catch {
    /* fall through */
  }
  return DEFAULT_TABS;
}

export const ADMIN_ITEM: NavItem = { to: '/admin', key: 'nav.admin', icon: Shield, testId: 'nav-admin' };
export const SIDEBAR_ITEMS = PAGE_ITEMS;
/** Default split (used by the tour for its page list). */
export const TAB_ITEMS: NavItem[] = [...PAGE_ITEMS.filter((i) => DEFAULT_TABS.includes(i.to)), MORE_ITEM];
export const MORE_ITEMS: NavItem[] = PAGE_ITEMS.filter((i) => !DEFAULT_TABS.includes(i.to));
