import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/en.json';
import he from '../../src/shared/i18n/he.json';
import { findTarget, placePopover, TOUR_PATHS, TOUR_STEPS, tourSteps } from '../../src/client/lib/tour';
import { buildDemo } from '../../src/server/seed/demo';
import { DEFAULT_CATEGORIES } from '../../src/server/seed/defaults';
import { addDays, monthOf } from '../../src/shared/dates';

const el = (w: number, h: number) => ({ getBoundingClientRect: () => ({ width: w, height: h }) }) as unknown as HTMLElement;
const root = (map: Record<string, HTMLElement[]>) => ({ querySelectorAll: (sel: string) => map[/"(.+)"/.exec(sel)![1]!] ?? [] }) as unknown as ParentNode;

describe('tour steps', () => {
  it('every step has text in both languages, ids are unique', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const s of TOUR_STEPS) for (const cat of [en, he] as { tour: { steps: Record<string, { title: string; body: string }> } }[]) expect(cat.tour.steps[s.id]?.body, s.id).toBeTruthy();
  });
  it('drops write-only steps for viewers, keeps one page for the ⓘ, fills in the review month', () => {
    const all = tourSteps({ canWrite: true, month: '2026-10', cardMonth: '2026-11' });
    const viewer = tourSteps({ canWrite: false, month: '2026-10', cardMonth: '2026-11' });
    expect(viewer.length).toBeLessThan(all.length);
    expect(viewer.some((s) => s.id === 'budgetAdd')).toBe(false);
    expect(tourSteps({ canWrite: true, page: '/budget', month: 'x', cardMonth: '2026-11' }).map((s) => s.id)).toEqual(['budgetAdd', 'budgetTop']);
    expect(all.find((s) => s.id === 'todo')!.path).toBe('/transactions?from=2026-11-01&to=2026-11-30');
    expect(all.find((s) => s.id === 'reviewFinal')!.path).toBe('/review?month=2026-10&step=6');
    expect(TOUR_PATHS.has('/forecast')).toBe(true);
    expect(TOUR_PATHS.has('/household')).toBe(false);
  });
  it('a missing or unrendered target resolves to null (the step is skipped)', () => {
    expect(findTarget(root({}), 'budget-add')).toBeNull();
    expect(findTarget(root({ 'budget-add': [el(0, 0)] }), 'budget-add')).toBeNull();
    const shown = el(40, 40);
    expect(findTarget(root({ nav: [el(0, 0), shown] }), 'nav')).toBe(shown);
  });
});

describe('popover placement', () => {
  const vp = { width: 393, height: 660 };
  const pop = { width: 300, height: 160 };
  const overlaps = (a: { top: number; left: number; width: number; height: number }, p: { top: number; left: number }) =>
    p.left < a.left + a.width && p.left + pop.width > a.left && p.top < a.top + a.height && p.top + pop.height > a.top;
  it('goes below a high target and above a low one, never covering it', () => {
    const high = { top: 100, left: 20, width: 80, height: 40 };
    const low = { top: 560, left: 20, width: 353, height: 70 };
    const a = placePopover(high, pop, vp, false);
    const b = placePopover(low, pop, vp, false);
    expect(a.side).toBe('below');
    expect(b.side).toBe('above');
    expect(overlaps(high, a)).toBe(false);
    expect(overlaps(low, b)).toBe(false);
  });
  it('aligns with the start edge: left in LTR, right in RTL, clamped to the screen', () => {
    const t = { top: 100, left: 300, width: 80, height: 40 };
    expect(placePopover(t, pop, vp, false).left).toBe(vp.width - 8 - pop.width); // clamped
    expect(placePopover(t, pop, vp, true).left).toBe(300 + 80 - 300);
    expect(placePopover({ ...t, left: 10 }, pop, vp, true).left).toBe(8);
  });
  it('reports when neither side has room', () => {
    expect(placePopover({ top: 150, left: 0, width: 393, height: 380 }, pop, vp, false).fits).toBe(false);
    expect(placePopover({ top: 70, left: 0, width: 393, height: 300 }, pop, vp, false).fits).toBe(true);
  });
  it('goes beside a full-height sidebar on a wide screen', () => {
    const p = placePopover({ top: 0, left: 0, width: 240, height: 800 }, pop, { width: 1280, height: 800 }, false);
    expect(p).toMatchObject({ side: 'beside', fits: true, left: 252 });
  });
  it('centers without a target', () => {
    expect(placePopover(null, pop, vp, true)).toMatchObject({ side: 'center', left: (393 - 300) / 2 });
  });
});

describe('demo dataset', () => {
  it('is relative to today, with the things the tour points at', () => {
    const today = '2026-11-16';
    let n = 0;
    const cat = new Map(DEFAULT_CATEGORIES.map((d) => [d.key, `c-${d.key}`]));
    const d = buildDemo(today, 'he', cat, () => `id${n++}`, '2026-11-16T08:00:00Z');
    const dates = d.transactions.map((t) => t.date as string).sort();
    expect(dates.at(-1)! < today).toBe(true);
    expect(dates.at(-1)! >= addDays(today, -7)).toBe(true);
    expect(dates[0]!.slice(0, 7) <= monthOf(addDays(today, -150))).toBe(true);
    expect(d.transactions.some((t) => t.category_id === null)).toBe(true); // "needs attention"
    expect(d.transactions.some((t) => t.kind === 'card_lump' && t.has_splits === 0)).toBe(true); // unsplit card payment
    expect(d.budgets.length).toBeGreaterThan(3); // top-3 + see all
    expect(d.goals.length).toBeGreaterThan(0);
    expect(d.recurring_items.length).toBeGreaterThan(0);
    expect(d.planned_expenses.every((p) => (p.date as string) > today)).toBe(true);
  });
});
