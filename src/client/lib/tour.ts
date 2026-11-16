import { createContext } from 'react';
import { monthEnd, monthStart } from '../../shared/dates';

/**
 * Spotlight tour steps. Each points at an element marked `data-tour="<target>"` on `path` (`{month}` is
 * the demo's review month, `{ledger}` the month of its newest card charge); text lives in i18n `tour.steps.<id>`. `write` steps need write access.
 * A step whose target never shows up (role, feature off, no data) is skipped, never shown empty.
 */
export interface TourStep {
  id: string;
  path: string;
  target: string | null;
  write?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'welcome', path: '/', target: null },
  { id: 'nav', path: '/', target: 'nav' },
  { id: 'add', path: '/', target: 'add', write: true },
  { id: 'reviewDue', path: '/', target: 'review-due' },
  { id: 'monthSummary', path: '/', target: 'pnl' },
  { id: 'forecastCard', path: '/', target: 'dash-forecast' },
  { id: 'search', path: '/transactions?{ledger}', target: 'ledger-search' },
  { id: 'filters', path: '/transactions?{ledger}', target: 'ledger-filters' },
  { id: 'todo', path: '/transactions?{ledger}', target: 'todo' },
  { id: 'unsplit', path: '/transactions?{ledger}', target: 'todo-unsplit' },
  { id: 'txRow', path: '/transactions?{ledger}', target: 'tx-row' },
  { id: 'budgetAdd', path: '/budget', target: 'budget-add', write: true },
  { id: 'budgetTop', path: '/budget', target: 'budget-top' },
  { id: 'upcomingRecurring', path: '/upcoming', target: 'upcoming-recurring' },
  { id: 'plan', path: '/upcoming', target: 'upcoming-plan', write: true },
  { id: 'recurring', path: '/recurring', target: 'recurring-totals' },
  { id: 'forecastEom', path: '/forecast', target: 'forecast-eom' },
  { id: 'cushion', path: '/forecast', target: 'forecast-cushion' },
  { id: 'trendsRange', path: '/trends', target: 'trend-range' },
  { id: 'goals', path: '/goals', target: 'goal-card' },
  { id: 'categoryAdd', path: '/categories', target: 'category-add', write: true },
  { id: 'hideUnused', path: '/categories', target: 'hide-unused', write: true },
  { id: 'accountAdd', path: '/accounts', target: 'account-add', write: true },
  { id: 'bankLink', path: '/accounts', target: 'bank-link' },
  { id: 'importAccount', path: '/import', target: 'import-account' },
  { id: 'reviewStart', path: '/review', target: 'review-start' },
  { id: 'reviewFinal', path: '/review?month={month}&step=6', target: 'review-final' },
  { id: 'reviewAi', path: '/review?month={month}&step=6', target: 'review-ai' },
  { id: 'navBar', path: '/settings', target: 'navbar' },
  { id: 'reminders', path: '/settings', target: 'reminders' },
];

export const pathOf = (p: string) => p.split('?')[0]!;
/** Pages whose header shows the ⓘ that starts that page's part of the tour. */
export const TOUR_PATHS = new Set(TOUR_STEPS.filter((s) => s.target).map((s) => pathOf(s.path)));

/** The steps one run walks through: the whole tour, or one page's targeted steps. */
export function tourSteps(o: { canWrite: boolean; page?: string; month: string; cardMonth: string }): TourStep[] {
  const ledger = `from=${monthStart(o.cardMonth)}&to=${monthEnd(o.cardMonth)}`;
  return TOUR_STEPS.filter((s) => (!s.write || o.canWrite) && (!o.page || (s.target && pathOf(s.path) === o.page))).map((s) => ({ ...s, path: s.path.replace('{month}', o.month).replace('{ledger}', ledger) }));
}

/** First rendered (non-zero size) element marked with this tour target, or null. */
export function findTarget(root: Pick<ParentNode, 'querySelectorAll'>, target: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-tour~="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
/**
 * Popover position: below the target when it fits (or has more room), else above; aligned with the
 * target's start edge (right edge in RTL); clamped to the viewport; beside a target too tall for
 * either. No target: centered. `fits` is false when nothing has room (the caller then scrolls the target up and asks again).
 */
export function placePopover(t: Box | null, pop: { width: number; height: number }, vp: { width: number; height: number }, rtl: boolean, gap = 12, margin = 8) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  if (!t) return { top: clamp((vp.height - pop.height) / 2, margin, vp.height), left: clamp((vp.width - pop.width) / 2, margin, vp.width), side: 'center' as const, fits: true };
  const below = vp.height - (t.top + t.height) - gap - margin;
  const above = t.top - gap - margin;
  const fits = below >= pop.height || above >= pop.height;
  if (!fits) {
    // A tall target (the desktop sidebar): beside it, on the side with more room, if that fits.
    const after = vp.width - (t.left + t.width) - gap - margin;
    const before = t.left - gap - margin;
    if (Math.max(after, before) >= pop.width)
      return { top: clamp(t.top, margin, vp.height - margin - pop.height), left: after >= before ? t.left + t.width + gap : t.left - gap - pop.width, side: 'beside' as const, fits: true };
  }
  const side = below >= pop.height || below >= above ? ('below' as const) : ('above' as const);
  const top = side === 'below' ? t.top + t.height + gap : t.top - gap - pop.height;
  const left = rtl ? t.left + t.width - pop.width : t.left;
  return { top: clamp(top, margin, vp.height - margin - pop.height), left: clamp(left, margin, vp.width - margin - pop.width), side, fits };
}

export interface TourApi {
  /** One page's part of the tour (the ⓘ in the page header). */
  startPage: (path: string) => void;
  startFull: () => void;
}
export const TourCtx = createContext<TourApi | null>(null);
