import { describe, expect, it } from 'vitest';
import { DB, addMember, json, makeUser, ownerSetup, sessionFor } from './helpers';
import { defaultReviewMonth } from '../../src/server/db/sql/review';
import type { BaseFacts } from '../../src/server/db/sql/facts';

describe('defaultReviewMonth', () => {
  it('never picks the running month, even when data covers its last day', () => {
    const base = { today: '2026-11-30', asOf: '2026-11-30', complete: ['2026-09', '2026-10', '2026-11'] } as BaseFacts;
    expect(defaultReviewMonth(base)).toBe('2026-10');
    expect(defaultReviewMonth({ ...base, complete: [] })).toBe('2026-10');
  });
});
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

  it('a review becomes due automatically once a month ends (computed on read); complete or dismiss clears it', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    type List = { defaultMonth: string; due: string | null; available: string[] };
    const due = async () => (await json<List>('GET', '/api/reviews', { cookie: o.cookie })).body;
    const badge = async () => (await json<{ badges: { reviewDue: string | null } }>('GET', '/api/me', { cookie: o.cookie })).body.badges.reviewDue;
    const l = await due();
    expect(l.available[0]).toBe(l.defaultMonth);
    expect(l.available[0]! < new Date().toISOString().slice(0, 7)).toBe(true); // never the running month
    expect(l.due).toBeNull(); // the demo's last month ships completed
    await DB.prepare('DELETE FROM reviews WHERE month = ?1').bind(l.defaultMonth).run();
    expect((await due()).due).toBe(l.defaultMonth);
    expect(await badge()).toBe(l.defaultMonth);
    // viewers can neither complete nor dismiss, so /api/me never nags them
    const viewer = await makeUser('Viewer');
    await addMember(o.householdId, viewer, 'viewer');
    const vc = await sessionFor(viewer, o.householdId);
    expect((await json<{ badges: { reviewDue: string | null } }>('GET', '/api/me', { cookie: vc })).body.badges.reviewDue).toBeNull();
    expect((await json('POST', `/api/reviews/${l.defaultMonth}/dismiss`, { cookie: o.cookie })).status).toBe(200);
    expect((await due()).due).toBeNull();
    expect(await badge()).toBeNull();
    expect((await json<{ status: string }>('GET', `/api/reviews/${l.defaultMonth}`, { cookie: o.cookie })).body.status).toBe('draft');
  });
});
