import { describe, expect, it } from 'vitest';
import { DB, addMember, json, makeHousehold, makeUser, ownerSetup, sessionFor } from './helpers';

async function demo() {
  const o = await ownerSetup('Owner', 'AI home');
  await json('POST', '/api/household/sample-data', { cookie: o.cookie });
  return o;
}
const today = () => new Date().toISOString().slice(0, 10);

describe('AI opt-in, limits, features (AC12.3, AC13.1–13.4)', () => {
  it('off by default; owner-only consent records who/when/provider; disabled → typed error', async () => {
    const o = await demo();
    const st = await json<{ available: boolean; enabled: boolean; provider: string; model: string; trainsOnInputs: boolean; limits: { categorize: number; review: number; globalDaily: number } }>('GET', '/api/ai/status', { cookie: o.cookie });
    expect(st.body).toMatchObject({ available: true, enabled: false, provider: 'mock', trainsOnInputs: false, limits: { categorize: 10, review: 5, globalDaily: 150 } });
    expect((await json<{ error: { code: string } }>('POST', '/api/ai/categorize', { cookie: o.cookie })).body.error.code).toBe('ai_disabled');
    const m = await makeUser('Member');
    await addMember(o.householdId, m, 'member');
    expect((await json<{ error: { code: string } }>('POST', '/api/ai/consent', { cookie: await sessionFor(m, o.householdId), body: { enabled: true } })).body.error.code).toBe('forbidden_role');
    expect((await json('POST', '/api/ai/consent', { cookie: o.cookie, body: { enabled: true } })).status).toBe(200);
    const h = await DB.prepare('SELECT ai_enabled, ai_consent_by, ai_consent_at, ai_consent_provider FROM households WHERE id = ?1').bind(o.householdId).first<Record<string, unknown>>();
    expect(h).toMatchObject({ ai_enabled: 1, ai_consent_by: o.userId, ai_consent_provider: expect.stringContaining('mock') });
    expect(h!.ai_consent_at).toBeTruthy();
  });

  it('categorize suggestions → apply sets category_source=ai and ai rules', async () => {
    const o = await demo();
    await json('POST', '/api/ai/consent', { cookie: o.cookie, body: { enabled: true } });
    const s = await json<{ suggestions: { key: string; categoryId: string; direction: 'in' | 'out'; description: string }[] }>('POST', '/api/ai/categorize', { cookie: o.cookie });
    expect(s.status).toBe(200);
    // bit / paybox transfers (people's names) are never sent
    expect(s.body.suggestions.some((x) => /bit|paybox/i.test(x.description))).toBe(false);
    const all = await DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?1 AND category_id IS NULL").bind(o.householdId).first<{ n: number }>();
    expect(all!.n).toBeGreaterThan(0);
    if (s.body.suggestions.length) {
      const a = await json<{ updated: number }>('POST', '/api/ai/categorize/apply', { cookie: o.cookie, body: { items: s.body.suggestions.map((x) => ({ key: x.key, categoryId: x.categoryId, direction: x.direction })) } });
      expect(a.body.updated).toBeGreaterThan(0);
      expect((await DB.prepare("SELECT COUNT(*) AS n FROM category_rules WHERE household_id = ?1 AND source = 'ai'").bind(o.householdId).first<{ n: number }>())!.n).toBeGreaterThan(0);
    }
  });

  it('review commentary is stored on the draft and kept when the review is completed', async () => {
    const o = await demo();
    await json('POST', '/api/ai/consent', { cookie: o.cookie, body: { enabled: true } });
    const month = (await json<{ defaultMonth: string }>('GET', '/api/reviews', { cookie: o.cookie })).body.defaultMonth;
    const [y, mm] = month.split('-').map(Number) as [number, number];
    const earlier = `${mm === 1 ? y - 1 : y}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}`;
    const r = await json<{ headline: string; commentary: Record<string, string> }>('POST', `/api/ai/review/${earlier}`, { cookie: o.cookie, headers: { 'x-mz-locale': 'he' } });
    expect(r.status).toBe(200);
    expect(r.body.headline).toContain('AI');
    expect(Object.keys(r.body.commentary)).toHaveLength(7);
    const g = await json<{ status: string; ai: { headline: string } }>('GET', `/api/reviews/${earlier}`, { cookie: o.cookie });
    expect(g.body.status).toBe('draft');
    expect(g.body.ai.headline).toBe(r.body.headline);
    await json('POST', `/api/reviews/${earlier}/complete`, { cookie: o.cookie });
    const done = await json<{ status: string; ai: { headline: string } }>('GET', `/api/reviews/${earlier}`, { cookie: o.cookie });
    expect(done.body).toMatchObject({ status: 'completed', ai: { headline: r.body.headline } });
  });

  it('limits: 5 review calls per household/day, then 429 ai_rate_limited; global cap', async () => {
    const o = await demo();
    await json('POST', '/api/ai/consent', { cookie: o.cookie, body: { enabled: true } });
    const month = (await json<{ defaultMonth: string }>('GET', '/api/reviews', { cookie: o.cookie })).body.defaultMonth;
    for (let i = 0; i < 5; i++) expect((await json('POST', `/api/ai/review/${month}`, { cookie: o.cookie })).status).toBe(200);
    expect((await json<{ error: { code: string } }>('POST', `/api/ai/review/${month}`, { cookie: o.cookie })).body.error.code).toBe('ai_rate_limited');
    // global cap across households
    const p = await demo();
    await json('POST', '/api/ai/consent', { cookie: p.cookie, body: { enabled: true } });
    const other = await makeHousehold('Busy');
    await DB.prepare("INSERT INTO ai_usage (household_id, day, feature, calls) VALUES (?1, ?2, 'categorize', 150)").bind(other, today()).run();
    expect((await json<{ error: { code: string } }>('POST', `/api/ai/review/${month}`, { cookie: p.cookie })).body.error.code).toBe('ai_rate_limited');
    await DB.prepare('DELETE FROM ai_usage WHERE household_id = ?1').bind(other).run();
  });

  it('disable again → AI routes refuse', async () => {
    const o = await demo();
    await json('POST', '/api/ai/consent', { cookie: o.cookie, body: { enabled: true } });
    await json('POST', '/api/ai/consent', { cookie: o.cookie, body: { enabled: false } });
    expect((await json<{ error: { code: string } }>('POST', '/api/ai/review/2026-01', { cookie: o.cookie })).body.error.code).toBe('ai_disabled');
  });
});
