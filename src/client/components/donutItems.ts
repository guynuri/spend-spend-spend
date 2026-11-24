import type { TFunction } from 'i18next';
import type { Category } from '../../shared/schemas/ledger';
import type { DonutInput } from '../../shared/donut';
import { colorSlotOf, OTHER_SLOT } from '../../shared/categoryLook';
import { GENERAL_ID } from '../../shared/domain/budget';

type Part = { categoryId: string; spentMinor: number };
/** One row of GET /api/trends/categories. */
export type SpendItem = { categoryId: string | null; spentMinor: number; members?: (Part & { subs?: Part[] })[]; subs?: Part[] };

/**
 * Ring slices from the by-category spending: each category in its own colour and emoji; a parent's
 * subcategories become its `children` (its own lines as "Parent (directly)"), and the general expenses
 * open into their categories (and those into their subcategories).
 */
export function donutItems(items: SpendItem[], cats: Map<string, Category>, t: TFunction): DonutInput[] {
  const part = (p: Part, parentId: string): DonutInput => {
    const c = cats.get(p.categoryId);
    return {
      // the parent's own lines get their own id: opening them would list the subcategories' too
      id: p.categoryId === parentId ? `${parentId}:direct` : p.categoryId,
      label: p.categoryId === parentId ? t('trends.directly', { name: cats.get(parentId)?.name ?? '' }) : (c?.name ?? ''),
      valueMinor: p.spentMinor,
      slot: c ? colorSlotOf(c) : OTHER_SLOT,
      emoji: c?.emoji ?? null,
    };
  };
  return items.map((i) => {
    const c = i.categoryId && i.categoryId !== GENERAL_ID ? cats.get(i.categoryId) : null;
    const id = i.categoryId ?? 'none';
    // only parts with spending (a refunded subcategory has none); opening is worth it when at least one
    // real subcategory is left, else the slice opens its transactions instead of a ring of "directly"
    const kids = (cid: string, subs: Part[] | undefined) => {
      const pos = (subs ?? []).filter((s) => s.spentMinor > 0);
      return pos.some((s) => s.categoryId !== cid) ? pos.map((s) => part(s, cid)) : undefined;
    };
    const withKids = (cid: string, subs: Part[] | undefined) => {
      const k = kids(cid, subs);
      return k ? { children: k } : {};
    };
    const children =
      i.categoryId === GENERAL_ID
        ? (i.members ?? []).filter((m) => m.spentMinor > 0).map((m) => ({ ...part(m, ''), label: cats.get(m.categoryId)?.name ?? '', ...withKids(m.categoryId, m.subs) }))
        : i.categoryId
          ? kids(i.categoryId, i.subs)
          : undefined;
    return {
      id,
      label: i.categoryId === GENERAL_ID ? t('budget.general.name') : c ? c.name : t('trends.uncategorized'),
      valueMinor: i.spentMinor,
      slot: c ? colorSlotOf(c) : i.categoryId === GENERAL_ID ? 'cat-7' : OTHER_SLOT,
      emoji: c?.emoji ?? (i.categoryId === GENERAL_ID ? '🧺' : null),
      ...(children?.length ? { children } : {}),
    };
  });
}
