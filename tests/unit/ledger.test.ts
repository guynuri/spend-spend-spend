import { describe, expect, it } from 'vitest';
import { csvCell, isCardLump, isGenericPayee, learnedRuleFor, matchRule, scaleSplit, type RuleLike } from '../../src/shared/domain/ledger';
import { CARD_ISSUER_PATTERNS } from '../../src/shared/domain/constants';
import { norm } from '../../src/shared/normalize';

const r = (id: string, source: RuleLike['source'], pattern: string, cat: string, extra: Partial<RuleLike> = {}): RuleLike => ({ id, field: 'description', match: 'contains', pattern_norm: pattern, sign: 'any', category_id: cat, source, ...extra });

describe('isGenericPayee', () => {
  it('flags payment apps, transfers, checks and ATM; not merchants', () => {
    for (const d of ['BIT transfer 0501234567', 'ביט', 'העברה בביט', 'PAYBOX', 'Venmo *John', 'PAYPAL *EBAY', 'העברת זה"ב', 'העברה לחשבון 12345', "צ'ק 1234", 'משיכת מזומן כספומט', 'ATM WITHDRAWAL'])
      expect(isGenericPayee(d), d).toBe(true);
    for (const d of ['שופרסל דיל', 'ביטוח ישיר', 'Bitter Cafe', 'Pizza Napoli', 'checkpoint market', 'ISRACARD'])
      expect(isGenericPayee(d), d).toBe(false);
  });
});

describe('rule precedence (PLAN §9.6)', () => {
  const rules = [r('1', 'seed', 'שופרסל', 'groc'), r('2', 'learned', 'שופרסל דיל', 'home'), r('3', 'user', 'דיל', 'kids'), r('4', 'ai', 'שופרסל דיל סניף', 'ai')];
  it('user > learned > ai > seed', () => {
    expect(matchRule(rules, { description: 'שופרסל דיל סניף', amountMinor: -1 })!.id).toBe('3');
    expect(matchRule(rules.slice(0, 2).concat(rules[3]!), { description: 'שופרסל דיל סניף', amountMinor: -1 })!.id).toBe('2');
    expect(matchRule([rules[0]!, rules[3]!], { description: 'שופרסל דיל סניף', amountMinor: -1 })!.id).toBe('4');
  });
  it('longer pattern first within a source; sign; equals / starts_with; operation type', () => {
    const rs = [r('a', 'seed', 'פז', 'fuel'), r('b', 'seed', 'פז יילו', 'snacks')];
    expect(matchRule(rs, { description: 'פז יילו 123', amountMinor: -1 })!.id).toBe('b');
    expect(matchRule([r('s', 'seed', 'משכורת', 'sal', { sign: 'in' })], { description: 'משכורת', amountMinor: -5 })).toBeNull();
    expect(matchRule([r('e', 'user', 'abc', 'x', { match: 'equals' })], { description: 'abc d', amountMinor: 1 })).toBeNull();
    expect(matchRule([r('e', 'user', 'abc', 'x', { match: 'starts_with' })], { description: 'ABC d', amountMinor: 1 })!.id).toBe('e');
    expect(matchRule([r('o', 'seed', 'הוראת קבע', 'x', { field: 'operation_type' })], { description: 'x', operationType: 'הוראת  קבע', amountMinor: -1 })!.id).toBe('o');
  });
  it('learned rule key uses normKey and the sign', () => {
    expect(learnedRuleFor({ description: 'Pizza  Napoli 12345', amountMinor: -1 })).toEqual({ field: 'description', match: 'equals', pattern_norm: 'pizza napoli', sign: 'out' });
  });
});

describe('scaleSplit (AC3.6)', () => {
  it('sums exactly, remainder to the largest line', () => {
    const s = scaleSplit([{ categoryId: 'a', amountMinor: -400000 }, { categoryId: 'b', amountMinor: -300000 }], -800001);
    expect(s.reduce((x, l) => x + l.amountMinor, 0)).toBe(-800001);
    const t = scaleSplit([{ categoryId: 'a', amountMinor: -100 }, { categoryId: 'b', amountMinor: -100 }, { categoryId: 'c', amountMinor: -100 }], -100);
    expect(t.map((l) => l.amountMinor)).toEqual([-34, -33, -33]);
    expect(scaleSplit([], 5)).toEqual([]);
  });
});

describe('csv & card lumps', () => {
  it('neutralizes formula injection and quotes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('-1e3')).toBe("'-1e3");
  });
  it('card lump only for negative amounts; latin patterns need word boundaries', () => {
    expect(isCardLump(norm('ישראכרט חיוב'), -100, CARD_ISSUER_PATTERNS)).toBe(true);
    expect(isCardLump(norm('ישראכרט החזר'), 100, CARD_ISSUER_PATTERNS)).toBe(false);
    expect(isCardLump(norm('CAL - כאל'), -1, CARD_ISSUER_PATTERNS)).toBe(true);
    expect(isCardLump(norm('Local cafe'), -1, CARD_ISSUER_PATTERNS)).toBe(false);
    expect(isCardLump(norm('MAX IT FINANCE'), -1, CARD_ISSUER_PATTERNS)).toBe(true);
    expect(isCardLump(norm('העברה למיכאל'), -1, CARD_ISSUER_PATTERNS)).toBe(false);
    expect(isCardLump(norm('מקסים ובניו'), -1, CARD_ISSUER_PATTERNS)).toBe(false);
    expect(isCardLump(norm('כאל-חיוב'), -1, CARD_ISSUER_PATTERNS)).toBe(true);
    expect(isCardLump(norm('cal-online'), -1, CARD_ISSUER_PATTERNS)).toBe(true);
  });
});
