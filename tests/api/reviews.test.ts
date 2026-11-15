import { describe, expect, it } from 'vitest';
import { json, ownerSetup } from './helpers';
import { CHAPTERS, type ReviewSnapshot } from '../../src/shared/domain/review';

describe('monthly review (AC12.1–12.2)', () => {
  it('draft has all 7 chapters; complete stores an immutable snapshot listed in history', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const list = await json<{ defaultMonth: string; reviews: { month: string }[] }>('GET', '/api/reviews', { cookie: o.cookie });
    expect(list.body.reviews.map((r) => r.month)).toEqual([list.body.defaultMonth]); // demo ships a completed review
    const month = list.body.defaultMonth;
    const done = await json<{ status: string; snapshot: ReviewSnapshot }>('GET', `/api/reviews/${month}`, { cookie: o.cookie });
    expect(done.body.status).toBe('completed');
    for (const c of CHAPTERS) expect(done.body.snapshot[c], c).toBeTruthy();
    expect((await json('POST', `/api/reviews/${month}/complete`, { cookie: o.cookie })).status).toBe(409);
    // an earlier month: draft → complete
    const [y, m] = month.split('-').map(Number) as [number, number];
    const earlier = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    const d = await json<{ status: string; snapshot: ReviewSnapshot }>('GET', `/api/reviews/${earlier}`, { cookie: o.cookie });
    expect(d.body.status).toBe('draft');
    const s = d.body.snapshot;
    expect(s.summary.incomeMinor).toBeGreaterThan(0);
    expect(s.spending.byCategory.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
    expect(s.spending.commentary.key).toMatch(/^review\.c\.spending\.(up|down|flat)_(over|under)$/);
    expect(s.wrapup.headline.key).toMatch(/^review\.h\./);
    expect(s.budget.total).toBe(12);
    const c = await json<{ status: string }>('POST', `/api/reviews/${earlier}/complete`, { cookie: o.cookie });
    expect(c.body.status).toBe('completed');
    // immutable: new data does not change the stored snapshot
    const acc = (await json<{ accounts: { id: string; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie })).body.accounts.find((a) => a.type === 'checking')!.id;
    await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: `${earlier}-15`, amountMinor: 9999999, direction: 'out', description: 'late addition', accountId: acc } });
    const again = await json<{ snapshot: ReviewSnapshot }>('GET', `/api/reviews/${earlier}`, { cookie: o.cookie });
    expect(again.body.snapshot.spending.totalMinor).toBe(s.spending.totalMinor);
    expect((await json<{ reviews: unknown[] }>('GET', '/api/reviews', { cookie: o.cookie })).body.reviews).toHaveLength(2);
    expect((await json('GET', '/api/reviews/2026-13', { cookie: o.cookie })).status).toBe(400);
  });
});
