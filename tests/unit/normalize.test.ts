import { describe, expect, it } from 'vitest';
import { cleanCell, norm, normKey } from '../../src/shared/normalize';

describe('normalize', () => {
  it('removes niqqud, bidi marks, unifies quotes, collapses spaces, lowercases', () => {
    expect(norm('  שָׁלוֹם   עוֹלָם ')).toBe('שלום עולם');
    expect(norm('‏בע״מ‎')).toBe('בע"מ');
    expect(norm('בע"מ')).toBe(norm('בע”מ'));
    expect(norm('צ׳יפס')).toBe("צ'יפס");
    expect(norm('SuperPharm  ')).toBe('superpharm');
    expect(norm(null)).toBe('');
  });
  it('normKey drops digit runs of 4 or more', () => {
    expect(normKey('כרטיס 4580 1234 חיוב')).toBe('כרטיס חיוב');
    expect(normKey('פז 123')).toBe('פז 123');
    expect(normKey('הוראת קבע 20261001')).toBe('הוראת קבע');
  });
  it('cleanCell strips bidi and nbsp', () => {
    expect(cleanCell('‫שכר עבודה‬ ')).toBe('שכר עבודה');
  });
});
