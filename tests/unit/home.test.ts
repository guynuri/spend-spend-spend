import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/en.json';
import he from '../../src/shared/i18n/he.json';
import { DEFAULT_HOME, HOME_WIDGETS, hiddenWidgets, moveItem, parseHomeWidgets } from '../../src/shared/home';
import { patchMeSchema } from '../../src/shared/schemas/me';
import { donutItems } from '../../src/client/components/donutItems';
import { donutSlices } from '../../src/shared/donut';
import { GENERAL_ID } from '../../src/shared/domain/budget';
import type { Category } from '../../src/shared/schemas/ledger';

describe('home layout', () => {
  it('parses a saved list: known ids only, no repeats; junk gives the default', () => {
    expect(parseHomeWidgets(['donut', 'hero', 'donut', 'nope', 3])).toEqual(['donut', 'hero']);
    expect(parseHomeWidgets([])).toEqual([]); // an empty Home is a choice, not junk
    expect(parseHomeWidgets(null)).toEqual(DEFAULT_HOME);
    expect(parseHomeWidgets('hero')).toEqual(DEFAULT_HOME);
  });
  it('lists the widgets not on Home in catalogue order', () => {
    expect(hiddenWidgets(DEFAULT_HOME)).toEqual(['usual', 'budgets', 'recent']);
    expect(hiddenWidgets([...HOME_WIDGETS])).toEqual([]);
  });
  it('moves an item up or down', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  it('the profile accepts a layout (or null to reset), never unknown or repeated ids', () => {
    expect(patchMeSchema.safeParse({ homeWidgets: ['hero', 'recent'] }).success).toBe(true);
    expect(patchMeSchema.safeParse({ homeWidgets: null }).success).toBe(true);
    expect(patchMeSchema.safeParse({ homeWidgets: ['hero', 'hero'] }).success).toBe(false);
    expect(patchMeSchema.safeParse({ homeWidgets: ['bogus'] }).success).toBe(false);
  });
  it('every widget has a name and a description in both languages', () => {
    for (const cat of [en, he] as unknown as { home: { widgets: Record<string, { title: string; body: string }> } }[])
      for (const id of HOME_WIDGETS) {
        expect(cat.home.widgets[id]?.title, id).toBeTruthy();
        expect(cat.home.widgets[id]?.body, id).toBeTruthy();
      }
  });
});

describe('donut drill-down', () => {
  const cat = (id: string, parentId: string | null = null) => ({ id, name: id, parentId, color: 'cat-1', emoji: null }) as unknown as Category;
  const cats = new Map(['food', 'organic', 'rent', 'misc'].map((id) => [id, cat(id, id === 'organic' ? 'food' : null)]));
  const t = ((k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k)) as never;
  it('a category with one subcategory still opens into it (not straight to its transactions)', () => {
    const items = donutItems([{ categoryId: 'food', spentMinor: 500, subs: [{ categoryId: 'organic', spentMinor: 500 }] }], cats, t);
    expect(items[0]!.children?.map((c) => c.id)).toEqual(['organic']);
  });
  it('a general-expenses category keeps its own subcategories one level down', () => {
    const items = donutItems([{ categoryId: GENERAL_ID, spentMinor: 900, members: [{ categoryId: 'food', spentMinor: 900, subs: [{ categoryId: 'food', spentMinor: 400 }, { categoryId: 'organic', spentMinor: 500 }] }] }], cats, t);
    const food = items[0]!.children![0]!;
    expect(food.children?.map((c) => c.id)).toEqual(['food:direct', 'organic']);
  });
  it('"Other" opens into the categories folded into it', () => {
    const many = Array.from({ length: 8 }, (_, k) => ({ id: `c${k}`, label: `c${k}`, valueMinor: 100 - k, slot: 'cat-1' }));
    const other = donutSlices(many, 5, 'Other').at(-1)!;
    expect(other.id).toBe('cat-other');
    expect(other.children?.map((c) => c.id)).toEqual(['c5', 'c6', 'c7']);
  });
});
