import { describe, expect, it } from 'vitest';
import { buildCategorizePayload, buildReviewPayload, isP2P, scrubText } from '../../src/shared/ai/payloads';
import { buildReview } from '../../src/shared/domain/review';

const CANARY = { phone: '052-1234567', account: '99-123-456789', email: 'dana.levi@example.com', person: 'Dana Levi' };

describe('AI payloads (AC13.2) — PII canary', () => {
  it('scrubs digit runs ≥ 5 and e-mails', () => {
    expect(scrubText(`Shufersal 052-1234567 ${CANARY.email} 4580 123`)).toBe('Shufersal 4580 123');
    expect(scrubText('x'.repeat(80))).toHaveLength(60);
  });
  it('categorize payload carries only scrubbed text, direction, rounded amount and category names', () => {
    const { payload, keys } = buildCategorizePayload(
      [
        { key: 'shop', description: `SuperShop ${CANARY.phone} ref ${CANARY.account}`, operationType: null, amountMinor: -12345 },
        { key: 'p2p', description: `העברה ב-bit ${CANARY.person}`, operationType: 'העברה', amountMinor: -5000 },
        { key: 'mail', description: `Store ${CANARY.email}`, operationType: null, amountMinor: 999 },
        { key: 'shop', description: 'dup', operationType: null, amountMinor: -1 },
      ],
      ['Groceries', 'Eating out'],
    );
    const s = JSON.stringify(payload);
    for (const v of Object.values(CANARY)) expect(s).not.toContain(v);
    expect(s).not.toContain('456789');
    expect(s).not.toContain('1234567');
    expect(payload).toMatchSnapshot();
    expect(keys).toEqual(['shop', 'mail']);
    expect(payload.items[0]).toEqual({ i: 0, text: 'SuperShop ref', dir: 'out', amount: 120 });
    expect(isP2P('PAYBOX Dana', null)).toBe(true);
  });
  it('review payload contains aggregates only', () => {
    const snap = buildReview({
      month: '2026-10',
      isLatestMonth: true,
      health: { score: 60, label: 'fair', change: 1, recommendations: [{ key: 'spend_less', gain: 2, amountMinor: 100 }] },
      income: { totalMinor: 100000, prevMinor: 90000, byCategory: [{ categoryId: 'a', name: 'Salary', amountMinor: 100000 }] },
      spending: { totalMinor: 80000, prevMinor: 70000, byCategory: [{ categoryId: 'b', name: 'Groceries', amountMinor: 80000 }], transactions: [{ date: '2026-10-02', description: `Transfer to ${CANARY.person} ${CANARY.account}`, amountMinor: -70000, category: null }, ...[1, 2, 3].map((n) => ({ date: '2026-10-03', description: 'small', amountMinor: -100 * n, category: null }))] },
      budget: { budgetedMinor: 0, spentBudgetedMinor: 0, lines: [] },
      goals: { activeCount: 0, savedMinor: 0, targetMinor: 0, items: [] },
      forecast: null,
      upcoming: [{ date: '2026-11-01', label: `Rent to ${CANARY.person}`, amountMinor: -1 }],
      insights: [{ id: 'x', severity: 'info', key: 'payment_soon', params: { label: CANARY.person }, href: '/' }],
    });
    expect(snap.spending.notable.length).toBe(1);
    const s = JSON.stringify(buildReviewPayload(snap));
    for (const v of Object.values(CANARY)) expect(s).not.toContain(v);
    expect(buildReviewPayload(snap)).toMatchSnapshot();
  });
});
