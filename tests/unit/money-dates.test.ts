import { describe, expect, it } from 'vitest';
import { formatMoney, minorToInput, parseMoneyInput, roundToStep } from '../../src/shared/money';
import { addDays, addMonths, clampDay, daysBetween, daysInMonth, excelSerialToDate, isValidDate, monthDiff, monthEnd, monthRange, todayInTz, weekStartsOn } from '../../src/shared/dates';

const strip = (s: string) => s.replace(/[\u200e\u200f]/g, '').replace(/[\u00a0\u202f]/g, ' ');

describe('money', () => {
  it('formats ILS in he and en with 2 and 0 decimals', () => {
    expect(strip(formatMoney(123456, { locale: 'en' }))).toMatch(/₪\s?1,234\.56/);
    expect(strip(formatMoney(123456, { locale: 'he' }))).toMatch(/1,234\.56\s?₪/);
    expect(strip(formatMoney(123456, { locale: 'en', decimals: 0 }))).toMatch(/₪\s?1,235/);
    expect(strip(formatMoney(-5000, { locale: 'en' }))).toMatch(/-₪\s?50\.00/);
    expect(strip(formatMoney(5000, { locale: 'en', signed: true }))).toMatch(/\+₪\s?50\.00/);
    expect(strip(formatMoney(0, { locale: 'en', signed: true }))).toMatch(/^₪\s?0\.00$/);
  });
  it('parses user input', () => {
    expect(parseMoneyInput('1,234.5')).toBe(123450);
    expect(parseMoneyInput('₪ 99')).toBe(9900);
    expect(parseMoneyInput('-12.05')).toBe(-1205);
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('1.234')).toBeNull();
    expect(minorToInput(-1205)).toBe('-12.05');
    expect(roundToStep(1234, 1000)).toBe(1000);
  });
});

describe('dates', () => {
  it('month math', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(monthEnd('2026-11')).toBe('2026-11-30');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', -13)).toBe('2024-12');
    expect(monthDiff('2025-11', '2026-02')).toBe(3);
    expect(clampDay('2026-02', 31)).toBe('2026-02-28');
    expect(monthRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
  it('day math', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2024-02-29')).toBe(true);
  });
  it('excel serial dates (1900 system)', () => {
    expect(excelSerialToDate(45931)).toBe('2025-10-01');
    expect(excelSerialToDate(46296)).toBe('2026-10-01');
    expect(excelSerialToDate(-1)).toBeNull();
  });
  it('today in timezone', () => {
    const at = new Date('2026-11-14T22:30:00Z');
    expect(todayInTz('Asia/Jerusalem', at)).toBe('2026-11-15');
    expect(todayInTz('UTC', at)).toBe('2026-11-14');
  });
  it('week starts on Sunday in he', () => {
    expect(weekStartsOn('he')).toBe(0);
  });
});
