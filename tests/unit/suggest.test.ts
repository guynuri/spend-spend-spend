import { describe, expect, it } from 'vitest';
import { median, suggestBudgets, type SuggestCategory } from '../../src/shared/domain/suggest';
import { GENERAL_ID } from '../../src/shared/domain/budget';

const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const series = (vals: number[]) => new Map(months.map((m, k) => [m, vals[k]!]));
const cats: SuggestCategory[] = [
  { id: 'rent', name: 'Rent', grp: 'fixed', mode: 'monthly', system: false },
  { id: 'food', name: 'Groceries', grp: 'variable', mode: 'monthly', system: false },
  { id: 'fun', name: 'Leisure', grp: 'variable', mode: 'monthly', system: false },
  { id: 'clothes', name: 'Clothing', grp: 'variable', mode: 'general', system: false },
  { id: 'care', name: 'Care', grp: 'variable', mode: 'general', system: false },
  { id: 'trip', name: 'Travel', grp: 'variable', mode: 'occasional', system: false },
  { id: 'card', name: 'Card', grp: 'variable', mode: 'monthly', system: true },
];
const spent = new Map([
  ['rent', series([520000, 520000, 520000, 520000, 520000, 520000])],
  ['food', series([300000, 320000, 310000, 1500000, 305000, 315000])], // one huge month
  ['fun', series([0, 0, 50000, 0, 0, 0])], // mostly nothing
  ['clothes', series([20000, 0, 40000, 10000, 30000, 0])],
  ['care', series([10000, 10000, 10000, 10000, 10000, 10000])],
  ['card', series([900000, 900000, 900000, 900000, 900000, 900000])],
]);
const base = { months, spent, yearSpent: new Map([['trip', 1234500]]), categories: cats, generalName: 'General', savingsTarget: 0.1 };

describe('suggested budgets', () => {
  it('median ignores one unusual month', () => {
    expect(median([3, 1, 100])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // rounded mean of the middle two
    expect(median([])).toBe(0);
  });
  it('fixed bills stay, everyday is squeezed and rounded, general is pooled, occasional is yearly', () => {
    const s = suggestBudgets({ ...base, income: series(Array(6).fill(2500000)), squeeze: 0.1 })!;
    const by = (id: string) => s.lines.find((l) => l.categoryId === id);
    expect(by('rent')).toMatchObject({ kind: 'fixed', usualMinor: 520000, suggestedMinor: 520000 });
    expect(by('food')).toMatchObject({ kind: 'everyday', usualMinor: 312500, suggestedMinor: 280000 }); // 312,500 × 0.9 → ₪2,800
    expect(by('fun')).toBeUndefined(); // usually nothing
    expect(by(GENERAL_ID)).toMatchObject({ kind: 'general', usualMinor: 25000, suggestedMinor: 25000 }); // pooled months 300,100,500,200,400,100 → median ₪250; −10 % = ₪225 → nearest ₪50
    expect(by('trip')).toMatchObject({ kind: 'occasional', usualMinor: 1234500, suggestedMinor: 1240000 });
    expect(by('card')).toBeUndefined(); // system placeholder
    expect(s.incomeMinor).toBe(2500000);
    expect(s.savingsTargetMinor).toBe(250000);
    expect(s.shortfallMinor).toBe(0);
    expect(s.lines.every((l) => !l.scaled)).toBe(true);
  });
  it('shrinks everyday limits to fit income minus savings, never below 70 % of usual', () => {
    // income 900,000: room = 900,000 − 90,000 − 520,000 − 103,333 ≈ 186,667 for everyday wanting 305,000
    const s = suggestBudgets({ ...base, income: series(Array(6).fill(900000)), squeeze: 0 })!;
    const food = s.lines.find((l) => l.categoryId === 'food')!;
    expect(food.scaled).toBe(true);
    expect(food.suggestedMinor).toBe(215000); // floor at 70 % of 312,500 → ₪2,150
    expect(s.lines.find((l) => l.categoryId === 'rent')!.suggestedMinor).toBe(520000); // bills untouched
    expect(s.shortfallMinor).toBeGreaterThan(0);
  });
  it('no complete months: nothing to suggest', () => {
    expect(suggestBudgets({ ...base, months: [], income: new Map(), squeeze: 0 })).toBeNull();
  });
});
