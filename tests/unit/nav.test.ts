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

describe('sections', () => {
  it('every page is reachable: a navigation entry or a page of a section whose hub is one', async () => {
    const { ALL_PAGES, SECTIONS, navTargetOf } = await import('../../src/client/lib/nav');
    for (const p of ALL_PAGES) expect(PAGE_ITEMS.some((i) => i.to === navTargetOf(p.to)), p.to).toBe(true);
    for (const s of SECTIONS) expect(s.pages[0]!.to).toBe(s.hub);
  });
  it('a saved bottom bar with a page that moved into a section keeps working', () => {
    expect(parseNavTabs(JSON.stringify(['/', '/forecast', '/budget']))).toEqual(['/', '/upcoming', '/budget']);
    expect(parseNavTabs(JSON.stringify(['/', '/review', '/budget']))).toEqual(['/', '/trends', '/budget']);
    // two old pages of one section would collide: back to the default
    expect(parseNavTabs(JSON.stringify(['/upcoming', '/forecast', '/budget']))).toEqual(DEFAULT_TABS);
  });
});
