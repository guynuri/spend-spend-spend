import { describe, expect, it } from 'vitest';
import { alertText, newBudgetAlerts, parseMarks, recapLine, recapWeek } from '../../src/shared/domain/alerts';
import { matchesDay } from '../../src/shared/reminders';

const line = (id: string, limit: number | null, spent: number) => ({ categoryId: id, name: id, limitMinor: limit, spentMinor: spent });

describe('budget alerts', () => {
  it('announces 80 % and 100 % once each per period, the more serious first', () => {
    let r = newBudgetAlerts([line('food', 1000, 850), line('fun', 1000, 300), line('none', null, 9999)], '2026-11', null);
    expect(r.alerts).toEqual([{ categoryId: 'food', name: 'food', level: 80, remainingMinor: 150 }]);
    // same state again: nothing new
    r = newBudgetAlerts([line('food', 1000, 900)], '2026-11', r.marks);
    expect(r.alerts).toEqual([]);
    // crossing 100 %, and another one jumping straight past it
    r = newBudgetAlerts([line('food', 1000, 1100), line('fun', 1000, 1500)], '2026-11', r.marks);
    expect(r.alerts.map((a) => [a.categoryId, a.level])).toEqual([
      ['fun', 100],
      ['food', 100],
    ]);
    expect(newBudgetAlerts([line('fun', 1000, 1500)], '2026-11', r.marks).alerts).toEqual([]); // its 80 % was marked too
    // a new period starts fresh
    expect(newBudgetAlerts([line('food', 1000, 850)], '2026-12', r.marks).alerts).toHaveLength(1);
  });
  it('marks survive a round trip and garbage reads as none', () => {
    const { marks } = newBudgetAlerts([line('a', 10, 9)], '2026-11', null);
    expect(parseMarks(JSON.stringify(marks))).toEqual(marks);
    expect(parseMarks('nope')).toBeNull();
    expect(parseMarks(null)).toBeNull();
  });
  it('push text is one short line', () => {
    const fmt = (m: number) => `₪${m / 100}`;
    expect(alertText([{ categoryId: 'g', name: 'Groceries', level: 80, remainingMinor: 40000 }], fmt, 'en')).toEqual({ title: 'Groceries: 80% of the budget', body: '₪400 left for this month' });
    expect(alertText([{ categoryId: 'g', name: 'Groceries', level: 100, remainingMinor: -1200 }], fmt, 'en').body).toBe('₪12 over the budget');
    expect(alertText([{ categoryId: 'a', name: 'A', level: 100, remainingMinor: 0 }, { categoryId: 'b', name: 'B', level: 80, remainingMinor: 5 }], fmt, 'en').title).toBe('2 budgets worth a look');
  });
});

describe('weekly recap', () => {
  it('covers the 7 days before the recap day', () => {
    expect(recapWeek('2026-11-22')).toEqual({ from: '2026-11-15', to: '2026-11-21', prevFrom: '2026-11-08', prevTo: '2026-11-14' });
  });
  it('fires on its weekday', () => {
    const s = { kind: 'recap' as const, freq: null, day: 0, weekdays: 127, hour: 10 };
    expect(matchesDay(s, '2026-11-22')).toBe(true); // a Sunday
    expect(matchesDay(s, '2026-11-23')).toBe(false);
  });
  it('one line: spent, vs the week before, left this month', () => {
    const fmt = (m: number) => `₪${m / 100}`;
    const r = { from: 'a', to: 'b', spentMinor: 124000, prevSpentMinor: 142000, top: [], leftMinor: 310000 };
    expect(recapLine(r, fmt, 'en')).toBe('You spent ₪1240 this week (₪180 less than the week before) · ₪3100 left this month');
    expect(recapLine({ ...r, prevSpentMinor: 0, leftMinor: null }, fmt, 'en')).toBe('You spent ₪1240 this week');
  });
});
