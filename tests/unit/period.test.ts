import { describe, expect, it } from 'vitest';
import { CALENDAR, makeCal } from '../../src/shared/period';
import { addDays } from '../../src/shared/dates';

describe('pay-day periods', () => {
  it('day 1 is the calendar month', () => {
    expect(CALENDAR.of('2026-02-28')).toBe('2026-02');
    expect([CALENDAR.start('2026-02'), CALENDAR.end('2026-02'), CALENDAR.days('2026-02')]).toEqual(['2026-02-01', '2026-02-28', 28]);
    expect(CALENDAR.sql('t.date')).toBe('substr(t.date, 1, 7)');
    expect(CALENDAR.dayIn('2026-11-22')).toBe(22);
  });
  it('an early start day labels the period by the month it starts in', () => {
    const c = makeCal(10);
    expect([c.start('2026-11'), c.end('2026-11'), c.days('2026-11')]).toEqual(['2026-11-10', '2026-12-09', 30]);
    expect(c.of('2026-11-10')).toBe('2026-11');
    expect(c.of('2026-12-09')).toBe('2026-11');
    expect(c.of('2026-11-09')).toBe('2026-10');
    expect(c.of('2027-03-09')).toBe('2027-02'); // across a short February
    expect(c.dayIn('2026-11-22')).toBe(13);
  });
  it('a late start day labels the period by the month it mostly covers', () => {
    const c = makeCal(25);
    expect([c.start('2026-11'), c.end('2026-11')]).toEqual(['2026-10-25', '2026-11-24']);
    expect(c.of('2026-10-25')).toBe('2026-11');
    expect(c.of('2026-11-24')).toBe('2026-11');
    expect(c.of('2026-11-25')).toBe('2026-12');
    expect(c.of('2026-12-31')).toBe('2027-01'); // across the year
    expect([c.start('2027-03'), c.end('2027-03')]).toEqual(['2027-02-25', '2027-03-24']);
  });
  it('periods tile the timeline with no gaps or overlaps', () => {
    for (const day of [1, 2, 10, 15, 16, 25, 28]) {
      const c = makeCal(day);
      let d = '2025-12-01';
      for (let i = 0; i < 800; i++, d = addDays(d, 1)) {
        const m = c.of(d);
        expect(d >= c.start(m) && d <= c.end(m), `${day}: ${d} in ${m}`).toBe(true);
      }
    }
  });
  it('an invalid start day falls back to calendar months', () => {
    expect(makeCal(31).day).toBe(1);
    expect(makeCal(0).day).toBe(1);
  });
});
