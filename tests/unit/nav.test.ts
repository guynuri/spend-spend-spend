import { describe, expect, it } from 'vitest';
import { DEFAULT_TABS, MORE_ITEMS, PAGE_ITEMS, TAB_ITEMS, parseNavTabs } from '../../src/client/lib/nav';

describe('bottom bar prefs', () => {
  it('accepts a valid pick and rejects anything malformed', () => {
    expect(parseNavTabs(JSON.stringify(['/goals', '/', '/upcoming']))).toEqual(['/goals', '/', '/upcoming']);
    for (const bad of [null, 'nope', '{}', '["/"]', '["/","/","/budget"]', '["/","/budget","/admin"]', '["/","/budget","/more"]'])
      expect(parseNavTabs(bad), String(bad)).toEqual(DEFAULT_TABS);
  });
  it('default split covers every page exactly once', () => {
    expect([...TAB_ITEMS.filter((i) => i.to !== '/more'), ...MORE_ITEMS].map((i) => i.to).sort()).toEqual(PAGE_ITEMS.map((i) => i.to).sort());
  });
});
