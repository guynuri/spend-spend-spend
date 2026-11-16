import { describe, expect, it } from 'vitest';
import { isDue, lastSlot, zonedTime, type Schedule } from '../../src/shared/reminders';

const TZ = 'Asia/Jerusalem';
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const at = (s: string) => new Date(s);
const daily = (hour: number, weekdays = 127): Schedule => ({ kind: 'daily', freq: null, day: null, weekdays, hour });
const weekly = (day: number, hour: number): Schedule => ({ kind: 'import', freq: 'weekly', day, weekdays: 127, hour });
const monthly = (day: number, hour: number): Schedule => ({ kind: 'import', freq: 'monthly', day, weekdays: 127, hour });

describe('zonedTime (Asia/Jerusalem)', () => {
  it('winter +02, summer +03', () => {
    expect(iso(zonedTime('2026-01-15', 9, TZ))).toBe('2026-01-15T07:00:00.000Z');
    expect(iso(zonedTime('2026-07-15', 9, TZ))).toBe('2026-07-15T06:00:00.000Z');
  });
  it('DST change days', () => {
    // spring forward Fri 2026-03-27 02:00 → 03:00; fall back Sun 2026-10-25 02:00 → 01:00
    expect(iso(zonedTime('2026-03-27', 9, TZ))).toBe('2026-03-27T06:00:00.000Z');
    expect(iso(zonedTime('2026-03-27', 2, TZ))).toBe('2026-03-27T00:00:00.000Z'); // skipped hour → 03:00 local
    expect(iso(zonedTime('2026-10-25', 9, TZ))).toBe('2026-10-25T07:00:00.000Z');
    expect(iso(zonedTime('2026-10-24', 9, TZ))).toBe('2026-10-24T06:00:00.000Z');
  });
});

describe('lastSlot / isDue', () => {
  it('daily: due on the first cron tick at or after the hour, then not again', () => {
    const s = daily(20);
    // 20:00 local on 2026-11-16 (+02) = 18:00Z; cron ticks every 15 min
    expect(isDue(s, TZ, at('2026-11-16T17:45:00Z'), '2026-11-15T18:00:00Z')).toBe(false);
    expect(isDue(s, TZ, at('2026-11-16T18:00:00Z'), '2026-11-15T18:00:00Z')).toBe(true);
    // sent at 18:00 → the 18:15 tick must not re-fire
    expect(isDue(s, TZ, at('2026-11-16T18:15:00Z'), '2026-11-16T18:00:00Z')).toBe(false);
    // a missed tick is caught later (not skipped)
    expect(isDue(s, TZ, at('2026-11-16T19:30:00Z'), '2026-11-15T18:00:00Z')).toBe(true);
  });
  it('daily honours the weekday mask', () => {
    const fridayOff = daily(9, 127 & ~(1 << 5)); // 2026-11-20 is a Friday
    expect(iso(lastSlot(fridayOff, TZ, at('2026-11-20T10:00:00Z')))).toBe('2026-11-19T07:00:00.000Z');
  });
  it('weekly on Sunday 09:00', () => {
    // 2026-11-15 is a Sunday
    expect(iso(lastSlot(weekly(0, 9), TZ, at('2026-11-18T12:00:00Z')))).toBe('2026-11-15T07:00:00.000Z');
    expect(iso(lastSlot(weekly(0, 9), TZ, at('2026-11-15T06:59:00Z')))).toBe('2026-11-08T07:00:00.000Z');
  });
  it('monthly clamps to the month end', () => {
    // day 31 in a 30-day month → the 30th; in February → the 28th
    expect(iso(lastSlot(monthly(31, 8), TZ, at('2026-11-30T07:00:00Z')))).toBe('2026-11-30T06:00:00.000Z');
    expect(iso(lastSlot(monthly(31, 8), TZ, at('2026-03-01T10:00:00Z')))).toBe('2026-02-28T06:00:00.000Z');
    expect(iso(lastSlot(monthly(31, 8), TZ, at('2026-02-27T10:00:00Z')))).toBe('2026-01-31T06:00:00.000Z');
  });
  it('a schedule across the DST change uses the local hour on both sides', () => {
    const s = daily(9);
    expect(iso(lastSlot(s, TZ, at('2026-03-27T06:00:00Z')))).toBe('2026-03-27T06:00:00.000Z');
    expect(iso(lastSlot(s, TZ, at('2026-03-27T05:59:00Z')))).toBe('2026-03-26T07:00:00.000Z');
    expect(iso(lastSlot(s, TZ, at('2026-10-25T07:00:00Z')))).toBe('2026-10-25T07:00:00.000Z');
  });
  it('review reminders have no clock slot', () => {
    expect(lastSlot({ kind: 'review', freq: null, day: null, weekdays: 127, hour: 9 }, TZ, at('2026-11-16T12:00:00Z'))).toBeNull();
  });
});
