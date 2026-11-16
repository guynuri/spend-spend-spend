import { describe, expect, it } from 'vitest';
import { DB, addMember, json, makeUser, ownerSetup, sessionFor } from './helpers';
import { DEMO_HOUSEHOLD } from '../../src/server/seed/demoHousehold';
import type { ForecastView } from '../../src/shared/domain/forecast';

describe('tour demo households', () => {
  it('can never get an owner, member or invite; admins cannot touch them', async () => {
    const o = await ownerSetup();
    expect((await json('POST', '/api/demo', { cookie: o.cookie, body: { locale: 'he' } })).status).toBe(200);
    const id = DEMO_HOUSEHOLD.he;
    const admin = await makeUser('Root', true);
    const ac = await sessionFor(admin, null);
    expect((await json('PATCH', `/api/admin/households/${id}`, { cookie: ac, body: { status: 'disabled' } })).status).toBe(404);
    expect((await json('POST', `/api/admin/households/${id}/owner-invite`, { cookie: ac })).status).toBe(404);
    expect(JSON.stringify((await json('GET', '/api/admin/households', { cookie: ac })).body)).not.toContain('~demo');
    // the database itself refuses (migration 0014), whatever path tries
    await expect(addMember(id, o.userId, 'owner')).rejects.toThrow(/demo household/);
    await expect(DB.prepare("INSERT INTO invites (id, token_hash, kind, household_id, role, created_at, expires_at) VALUES ('x', 'y', 'owner', ?1, 'owner', 'n', 'n')").bind(id).run()).rejects.toThrow(/demo household/);
    // rebuilt at most once a day: a second call keeps the same rows
    const n = async () => (await DB.prepare('SELECT COUNT(*) AS n, MIN(id) AS m FROM transactions WHERE household_id = ?1').bind(id).first<{ n: number; m: string }>())!;
    const before = await n();
    await json('POST', '/api/demo', { cookie: o.cookie, body: { locale: 'he' } });
    expect(await n()).toEqual(before);
    expect(before.n).toBeGreaterThan(50);
  });

  it('demo mode never shows the real user’s reminders or devices', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 20, weekdays: 31 } });
    await json('POST', '/api/demo', { cookie: o.cookie, body: { locale: 'en' } });
    const r = await json<{ reminders: unknown[]; devices: unknown[] }>('GET', '/api/reminders', { cookie: o.cookie, headers: { 'x-mz-demo': 'en' } });
    expect(r.status).toBe(200);
    expect(r.body.reminders).toEqual([]);
    expect(r.body.devices).toEqual([]);
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, headers: { 'x-mz-demo': 'en' }, body: { kind: 'review' } })).status).toBe(403);
  });
});

describe('safety cushion (forecast)', () => {
  it('members set it, viewers cannot; the forecast warns once the low point is under it', async () => {
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    const member = await makeUser('Mem');
    await addMember(o.householdId, member, 'member');
    const mc = await sessionFor(member, o.householdId);
    const viewer = await makeUser('View');
    await addMember(o.householdId, viewer, 'viewer');
    const vc = await sessionFor(viewer, o.householdId);
    const f0 = (await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body;
    expect(f0.safetyBuffer).toBe(0);
    expect(f0.belowBuffer).toBe(false);
    const above = f0.low!.balance + 100_00;
    expect((await json('PATCH', '/api/household', { cookie: vc, body: { safetyBufferMinor: above } })).status).toBe(403);
    expect((await json('PATCH', '/api/household', { cookie: mc, body: { name: 'x' } })).status).toBe(403); // name stays owner-only
    expect((await json('PATCH', '/api/household', { cookie: mc, body: { safetyBufferMinor: above } })).status).toBe(200);
    const f1 = (await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body;
    expect(f1.safetyBuffer).toBe(above);
    expect(f1.belowBuffer).toBe(true);
  });
});
