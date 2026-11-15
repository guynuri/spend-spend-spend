import { describe, expect, it } from 'vitest';
import { toneSign } from '../../src/shared/money';
import { parseStored, presetOf, presetRange, shiftRange } from '../../src/client/features/trends/range';

describe('Money tone: in green, out red, neutral default, net by sign', () => {
  it.each([
    [500, undefined, 0],
    [-500, undefined, 0],
    [500, false, 0],
    [500, true, 1],
    [-500, true, -1],
    [0, true, 0],
    [500, 'in', 1],
    [500, 'out', -1],
    [-500, 'out', -1],
    [0, 'out', 0],
  ] as const)('%s with tone %s → %s', (minor, tone, cls) => expect(toneSign(minor, tone)).toBe(cls));
});

describe('trends date range', () => {
  const today = '2026-11-16';
  it('presets', () => {
    expect(presetRange('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('3m', today)).toEqual({ from: '2026-09-01', to: '2026-11-30' });
    expect(presetRange('6m', today)).toEqual({ from: '2026-06-01', to: '2026-11-30' });
    expect(presetRange('year', today)).toEqual({ from: '2026-01-01', to: '2026-11-30' });
    expect(presetRange('12m', today)).toEqual({ from: '2025-12-01', to: '2026-11-30' });
    expect(presetOf({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe('lastMonth');
    expect(presetOf({ from: '2026-10-02', to: '2026-10-31' }, today)).toBeUndefined();
  });
  it('shifts whole months by month count, other ranges by their length', () => {
    expect(shiftRange({ from: '2026-11-01', to: '2026-11-30' }, -1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(shiftRange({ from: '2026-09-01', to: '2026-11-30' }, 1)).toEqual({ from: '2026-12-01', to: '2027-02-28' });
    expect(shiftRange({ from: '2026-11-10', to: '2026-11-16' }, -1)).toEqual({ from: '2026-11-03', to: '2026-11-09' });
  });
  it('parses stored choices', () => {
    expect(parseStored('3m', today)).toEqual(presetRange('3m', today));
    expect(parseStored('2026-01-05..2026-02-01', today)).toEqual({ from: '2026-01-05', to: '2026-02-01' });
    expect(parseStored('2026-02-01..2026-01-05', today)).toBeNull();
    expect(parseStored('null..null', today)).toBeNull();
    expect(parseStored(null, today)).toBeNull();
  });
});
