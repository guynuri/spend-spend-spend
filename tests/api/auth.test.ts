import { beforeEach, describe, expect, it } from 'vitest';
import { DB, call, cookieFrom, json, makeHousehold, makeInvite, makeUser, ownerSetup, resetRateLimits, sessionFor } from './helpers';
import { SoftAuthenticator } from './softauthn';
import { runCleanup } from '../../src/server/db/cleanup';

beforeEach(resetRateLimits);

async function register(token: string, extra: Record<string, unknown> = {}, auth = new SoftAuthenticator()) {
  const o = await json<{ challengeId: string; options: { challenge: string; user: { id: string } } }>('POST', '/api/auth/register/options', { body: { token, displayName: 'Dana', ...extra } });
  if (o.status !== 200) return { status: o.status, body: o.body, auth, cookie: '' };
  const cred = await auth.register(o.body.options);
  const v = await json('POST', '/api/auth/register/verify', { body: { token, challengeId: o.body.challengeId, response: cred, ...('householdName' in extra ? { householdName: extra.householdName } : {}) } });
  return { status: v.status, body: v.body, auth, cookie: cookieFrom(v.res), res: v.res };
}
async function login(auth: SoftAuthenticator, counter?: number) {
  const o = await json<{ challengeId: string; options: { challenge: string } }>('POST', '/api/auth/login/options');
  const resp = await auth.login(o.body.options, counter);
  return json('POST', '/api/auth/login/verify', { body: { challengeId: o.body.challengeId, response: resp } });
}

describe('bootstrap (AC1.1) and sessions (AC1.8)', () => {
  it('first run creates super-admin + household; second attempt is 410', async () => {
    await DB.prepare('DELETE FROM users WHERE is_super_admin = 1').run();
    const r = await register('test-bootstrap-token', { householdName: 'Our home' });
    expect(r.status).toBe(200);
    const sc = r.res!.headers.get('set-cookie')!;
    expect(sc).toMatch(/^__Host-mz_session=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    expect(sc).toMatch(/Path=\//);
    const me = await json<{ user: { isSuperAdmin: boolean }; active: { name: string }; role: string }>('GET', '/api/me', { cookie: r.cookie });
    expect(me.status).toBe(200);
    expect(me.body.user.isSuperAdmin).toBe(true);
    expect(me.body.active.name).toBe('Our home');
    expect(me.body.role).toBe('owner');
    const cats = await DB.prepare('SELECT COUNT(*) AS n FROM categories WHERE household_id = (SELECT active_household_id FROM sessions LIMIT 1)').first<{ n: number }>();
    expect(cats!.n).toBe(19);
    // second attempt
    const again = await json('POST', '/api/auth/register/options', { body: { token: 'test-bootstrap-token', displayName: 'Eve' } });
    expect(again.status).toBe(410);
    // passkey login works, counter regression is rejected
    const li = await login(r.auth);
    expect(li.status).toBe(200);
    expect(cookieFrom(li.res)).toMatch(/^__Host-mz_session=/);
    const bad = await login(r.auth, 1);
    expect(bad.status).toBe(400);
  });

  it('challenge is single use', async () => {
    const o = await json<{ challengeId: string; options: { challenge: string } }>('POST', '/api/auth/login/options');
    const v1 = await json('POST', '/api/auth/login/verify', { body: { challengeId: o.body.challengeId, response: { id: 'nope' } } });
    expect(v1.status).toBe(400);
    const v2 = await json<{ error: { code: string } }>('POST', '/api/auth/login/verify', { body: { challengeId: o.body.challengeId, response: { id: 'nope' } } });
    expect(v2.body.error.code).toBe('challenge_expired');
  });

  it('no cookie → 401; expired → 401; logout deletes the row; logout-all deletes all', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401);
    const { userId, householdId } = await ownerSetup();
    const expired = await sessionFor(userId, householdId, { expiresInMs: -1000 });
    expect((await call('GET', '/api/me', { cookie: expired })).status).toBe(401);
    const absExpired = await sessionFor(userId, householdId, { absoluteInMs: -1000 });
    expect((await call('GET', '/api/me', { cookie: absExpired })).status).toBe(401);
    const a = await sessionFor(userId, householdId);
    const b = await sessionFor(userId, householdId);
    expect((await call('POST', '/api/auth/logout', { cookie: a })).status).toBe(200);
    expect((await call('GET', '/api/me', { cookie: a })).status).toBe(401);
    expect((await call('GET', '/api/me', { cookie: b })).status).toBe(200);
    const c = await sessionFor(userId, householdId);
    expect((await call('POST', '/api/auth/logout-all', { cookie: c })).status).toBe(200);
    expect((await call('GET', '/api/me', { cookie: b })).status).toBe(401);
    const n = await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1').bind(userId).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('rolling expiry refreshes at most hourly', async () => {
    const { userId, householdId } = await ownerSetup();
    const fresh = await sessionFor(userId, householdId, { expiresInMs: 1000 * 60 * 60 * 24, lastSeenAgoMs: 2 * 3600_000 });
    await call('GET', '/api/me', { cookie: fresh });
    const row = await DB.prepare('SELECT expires_at FROM sessions WHERE user_id = ?1').bind(userId).first<{ expires_at: string }>();
    expect(Date.parse(row!.expires_at) - Date.now()).toBeGreaterThan(59 * 86_400_000);
  });

  it('cron cleanup removes expired sessions', async () => {
    const { userId, householdId } = await ownerSetup();
    await sessionFor(userId, householdId, { expiresInMs: -1000 });
    await runCleanup(DB);
    const n = await DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1').bind(userId).first<{ n: number }>();
    expect(n!.n).toBe(1); // only the valid one from ownerSetup remains
  });
});

describe('CSRF', () => {
  it('rejects non-GET without header, wrong origin, or non-JSON', async () => {
    const { cookie } = await ownerSetup();
    const code = async (o: Parameters<typeof call>[2]) => (await json<{ error: { code: string } }>('POST', '/api/auth/logout', { cookie, ...o })).body.error?.code;
    expect(await code({ headers: { 'x-mz': '0' } })).toBe('csrf');
    expect(await code({ headers: { origin: 'https://evil.example' } })).toBe('csrf');
    expect(await code({ headers: { 'content-type': 'text/plain' } })).toBe('csrf');
    expect(await code({ csrf: false })).toBe('csrf');
  });
});

describe('invites & tokens (AC1.3, AC1.7)', () => {
  it('member invite: inspect, register, reuse → 410', async () => {
    const owner = await makeUser('Owner');
    const hid = await makeHousehold('Levi family', owner);
    const { token } = await makeInvite({ kind: 'member', householdId: hid, role: 'viewer' });
    const ins = await json<{ kind: string; householdName: string; role: string }>('POST', '/api/invites/inspect', { body: { token } });
    expect(ins.body).toEqual({ kind: 'member', householdName: 'Levi family', role: 'viewer' });
    const r = await register(token);
    expect(r.status).toBe(200);
    const me = await json<{ role: string }>('GET', '/api/me', { cookie: r.cookie });
    expect(me.body.role).toBe('viewer');
    expect((await json('POST', '/api/invites/inspect', { body: { token } })).status).toBe(410);
    expect((await register(token)).status).toBe(410);
  });

  it('expired, revoked and unknown tokens → 410; 5 failures → 429', async () => {
    const hid = await makeHousehold('X');
    const exp = await makeInvite({ kind: 'member', householdId: hid, role: 'member', expiresInMs: -1 });
    const rev = await makeInvite({ kind: 'member', householdId: hid, role: 'member', revoked: true });
    expect((await json('POST', '/api/invites/inspect', { body: { token: exp.token } })).status).toBe(410);
    expect((await json('POST', '/api/invites/inspect', { body: { token: rev.token } })).status).toBe(410);
    expect((await json('POST', '/api/invites/inspect', { body: { token: 'x'.repeat(43) } })).status).toBe(410);
    for (let i = 0; i < 2; i++) await json('POST', '/api/invites/inspect', { body: { token: 'y'.repeat(43) } });
    expect((await json('POST', '/api/invites/inspect', { body: { token: 'z'.repeat(43) } })).status).toBe(429);
  });

  it('tokens are stored only as SHA-256', async () => {
    const hid = await makeHousehold('Y');
    const { token, id } = await makeInvite({ kind: 'member', householdId: hid, role: 'member' });
    const row = await DB.prepare('SELECT * FROM invites WHERE id = ?1').bind(id).first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('existing user accepts an invite to another household', async () => {
    const a = await ownerSetup('Ann', 'A');
    const hidB = await makeHousehold('B home');
    const { token } = await makeInvite({ kind: 'member', householdId: hidB, role: 'member' });
    expect((await json('POST', '/api/invites/accept', { cookie: a.cookie, body: { token } })).status).toBe(200);
    const me = await json<{ households: { name: string }[]; active: { name: string } }>('GET', '/api/me', { cookie: a.cookie });
    expect(me.body.households.map((h) => h.name).sort()).toEqual(['A', 'B home']);
    expect(me.body.active.name).toBe('B home');
    expect((await json('POST', '/api/invites/accept', { cookie: a.cookie, body: { token } })).status).toBe(410);
    // switch back
    expect((await json('POST', '/api/session/household', { cookie: a.cookie, body: { id: a.householdId } })).status).toBe(200);
    expect((await json<{ active: { name: string } }>('GET', '/api/me', { cookie: a.cookie })).body.active.name).toBe('A');
    // cannot switch to a household without membership
    const other = await makeHousehold('C');
    expect((await json('POST', '/api/session/household', { cookie: a.cookie, body: { id: other } })).status).toBe(404);
  });

  it('recovery link adds a passkey to the existing user (AC1.9)', async () => {
    const { userId, householdId, cookie } = await ownerSetup('Rina');
    const member = await makeUser('Moshe');
    await DB.prepare("INSERT INTO memberships (household_id, user_id, role, created_at) VALUES (?1, ?2, 'member', ?3)").bind(householdId, member, new Date().toISOString()).run();
    const rec = await json<{ link: string }>('POST', `/api/household/members/${member}/recovery`, { cookie });
    expect(rec.status).toBe(201);
    const token = rec.body.link.split('#')[1]!;
    expect(rec.body.link).toContain('/recover#');
    const ins = await json<{ kind: string }>('POST', '/api/invites/inspect', { body: { token } });
    expect(ins.body.kind).toBe('recovery');
    const r = await register(token, { displayName: undefined });
    expect(r.status).toBe(200);
    const me = await json<{ user: { id: string } }>('GET', '/api/me', { cookie: r.cookie });
    expect(me.body.user.id).toBe(member);
    expect(userId).not.toBe(member);
  });
});

describe('admin (AC1.3)', () => {
  it('creates household + owner invite; lists metadata only; non-admin forbidden', async () => {
    const admin = await makeUser('Admin', true);
    const cookie = await sessionFor(admin, null);
    const cr = await json<{ id: string; invite: { link: string } }>('POST', '/api/admin/households', { cookie, body: { name: 'Cohen' } });
    expect(cr.status).toBe(201);
    expect(cr.body.invite.link).toMatch(/\/invite#[A-Za-z0-9_-]{43}$/);
    const list = await json<{ households: Record<string, unknown>[] }>('GET', '/api/admin/households', { cookie });
    const h = list.body.households.find((x) => x.id === cr.body.id)!;
    expect(Object.keys(h).sort()).toEqual(['createdAt', 'id', 'lastImportAt', 'memberCount', 'name', 'owners', 'status']);
    const token = cr.body.invite.link.split('#')[1]!;
    const r = await register(token, { displayName: 'Cohen owner' });
    expect(r.status).toBe(200);
    expect((await json<{ role: string }>('GET', '/api/me', { cookie: r.cookie })).body.role).toBe('owner');
    expect((await json('GET', '/api/admin/households', { cookie: r.cookie })).status).toBe(403);
    // disable → tenant routes refused
    await json('PATCH', `/api/admin/households/${cr.body.id}`, { cookie, body: { status: 'disabled' } });
    expect((await json<{ error: { code: string } }>('GET', '/api/household', { cookie: r.cookie })).body.error.code).toBe('household_disabled');
  });
});

describe('members & roles (AC1.4, AC1.5)', () => {
  it('owner manages invites and roles; last owner protected; viewer is read-only', async () => {
    const { householdId, cookie, userId } = await ownerSetup();
    const inv = await json<{ id: string; link: string }>('POST', '/api/household/invites', { cookie, body: { role: 'member' } });
    expect(inv.status).toBe(201);
    expect((await json<{ invites: unknown[] }>('GET', '/api/household/invites', { cookie })).body.invites).toHaveLength(1);
    expect((await json('DELETE', `/api/household/invites/${inv.body.id}`, { cookie })).status).toBe(200);
    expect((await json<{ invites: unknown[] }>('GET', '/api/household/invites', { cookie })).body.invites).toHaveLength(0);
    // last owner
    expect((await json('PATCH', `/api/household/members/${userId}`, { cookie, body: { role: 'member' } })).status).toBe(409);
    expect((await json('DELETE', `/api/household/members/${userId}`, { cookie })).status).toBe(409);
    // viewer
    const v = await makeUser('Viewer');
    await DB.prepare("INSERT INTO memberships (household_id, user_id, role, created_at) VALUES (?1, ?2, 'viewer', ?3)").bind(householdId, v, new Date().toISOString()).run();
    const vc = await sessionFor(v, householdId);
    expect((await json('GET', '/api/household/members', { cookie: vc })).status).toBe(200);
    expect((await json<{ error: { code: string } }>('PATCH', '/api/household', { cookie: vc, body: { name: 'x' } })).body.error.code).toBe('forbidden_role');
    expect((await json<{ error: { code: string } }>('POST', '/api/household/invites', { cookie: vc, body: { role: 'member' } })).body.error.code).toBe('forbidden_role');
    // promote viewer, then demote original owner works, then remove
    expect((await json('PATCH', `/api/household/members/${v}`, { cookie, body: { role: 'owner' } })).status).toBe(200);
    expect((await json('PATCH', `/api/household/members/${userId}`, { cookie, body: { role: 'member' } })).status).toBe(200);
    // removal clears the removed user's active household
    expect((await json('DELETE', `/api/household/members/${userId}`, { cookie: vc })).status).toBe(200);
    expect((await json<{ active: unknown }>('GET', '/api/me', { cookie })).body.active).toBeNull();
    expect((await json<{ error: { code: string } }>('GET', '/api/household', { cookie })).body.error.code).toBe('no_household');
  });
});

describe('passkeys and sessions (M10)', () => {
  it('lists passkeys and sessions; the last passkey cannot be removed', async () => {
    const r = await (async () => {
      const owner = await makeUser('PK');
      const hid = await makeHousehold('PK home', owner);
      const { token } = await makeInvite({ kind: 'recovery', targetUserId: owner, householdId: hid });
      return { ...(await register(token, { displayName: undefined })), owner };
    })();
    const list = await json<{ passkeys: { id: string }[] }>('GET', '/api/auth/passkeys', { cookie: r.cookie });
    expect(list.body.passkeys).toHaveLength(1);
    const del = await json<{ error: { code: string } }>('DELETE', `/api/auth/passkeys/${list.body.passkeys[0]!.id}`, { cookie: r.cookie });
    expect(del.body.error.code).toBe('last_passkey');
    const s = await json<{ sessions: { current: boolean; id: string }[] }>('GET', '/api/auth/sessions', { cookie: r.cookie });
    expect(s.body.sessions.filter((x) => x.current)).toHaveLength(1);
    expect(JSON.stringify(s.body)).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('failed registration gives the invite back (review fix)', () => {
  it('a rolled-back registration leaves the link usable', async () => {
    const hid = await makeHousehold('Retry home');
    const first = await makeInvite({ kind: 'member', householdId: hid, role: 'member' });
    const r1 = await register(first.token);
    expect(r1.status).toBe(200);
    // same authenticator → same credential id → the account batch fails on the UNIQUE credential
    const second = await makeInvite({ kind: 'member', householdId: hid, role: 'member' });
    const r2 = await register(second.token, {}, r1.auth);
    expect(r2.status).toBe(409);
    expect((await DB.prepare('SELECT used_at FROM invites WHERE id = ?1').bind(second.id).first<{ used_at: string | null }>())!.used_at).toBeNull();
    expect((await register(second.token)).status).toBe(200);
  });
});
