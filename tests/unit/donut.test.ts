import { describe, expect, it } from 'vitest';
import { donutSlices } from '../../src/shared/donut';
import { colorSlotOf } from '../../src/shared/categoryLook';

const it_ = (id: string, v: number, slot: 'cat-1' | 'cat-2' | 'cat-3' = 'cat-1') => ({ id, label: id, valueMinor: v, slot });

describe('donutSlices', () => {
  it('drops non-positive amounts and sorts largest first', () => {
    const s = donutSlices([it_('a', 100), it_('b', 0), it_('c', 300, 'cat-2'), it_('d', -5)], 5, 'Other');
    expect(s.map((x) => x.id)).toEqual(['c', 'a']);
  });
  it('folds the tail into Other only when more than one item would be folded', () => {
    const six = Array.from({ length: 6 }, (_, k) => it_(`x${k}`, 100 - k));
    expect(donutSlices(six, 5, 'Other')).toHaveLength(6);
    expect(donutSlices(six, 5, 'Other').some((s) => s.id === 'cat-other')).toBe(false);
    const seven = [...six, it_('x6', 10)];
    const s = donutSlices(seven, 5, 'Other');
    expect(s).toHaveLength(6);
    expect(s[5]).toMatchObject({ id: 'cat-other', label: 'Other', valueMinor: 95 + 10, slot: 'cat-other' });
  });
  it('gives shown slices distinct colours, keeping the first owner of a colour', () => {
    const s = donutSlices([it_('a', 300, 'cat-1'), it_('b', 200, 'cat-1'), it_('c', 100, 'cat-2')], 5, 'Other');
    // c keeps its own colour; b (the clash) takes one nobody shown owns
    expect(s.map((x) => x.slot)).toEqual(['cat-1', 'cat-3', 'cat-2']);
  });
});

describe('colorSlotOf', () => {
  it('uses the stored slot, else a stable one from the id', () => {
    expect(colorSlotOf({ id: 'x', color: 'cat-4' })).toBe('cat-4');
    expect(colorSlotOf({ id: 'abc', color: '#fff' })).toBe(colorSlotOf({ id: 'abc' }));
  });
});

describe('ring geometry', () => {
  it('every slice gets a visible minimum and the lengths still fill the ring', async () => {
    const { arcLengths } = await import('../../src/shared/donut');
    const l = arcLengths([9700, 200, 100], 600, 40);
    expect(l[1]).toBe(40);
    expect(l[2]).toBe(40);
    expect(l.reduce((a, b) => a + b, 0)).toBeCloseTo(600);
    expect(arcLengths([1, 1], 10, 40)).toEqual([5, 5]); // no room: equal shares
  });
  it('a parent with subcategories keeps them as children through slicing', () => {
    const s = donutSlices([{ id: 'p', label: 'p', valueMinor: 10, slot: 'cat-1', children: [{ id: 'c', label: 'c', valueMinor: 10, slot: 'cat-1' }] }], 5, 'Other');
    expect(s[0]!.children).toHaveLength(1);
  });
});

describe('ring geometry, pinned minimum', () => {
  it('never leaves a slice under the minimum (the case that used to swap)', async () => {
    const { arcLengths } = await import('../../src/shared/donut');
    const l = arcLengths([1, 10.5, 88.5], 100, 10);
    expect(Math.min(...l)).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(l.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });
});
