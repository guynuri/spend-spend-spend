import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { DB, addMember, json, makeUser, ownerSetup, sessionFor } from './helpers';
import { runReminders } from '../../src/server/db/reminders';
import { b64url } from '../../src/server/lib/crypto';
import type { AppEnv } from '../../src/server/env';
import type { RemindersResponse } from '../../src/shared/reminders';

const raw = async (k: CryptoKey) => new Uint8Array((await crypto.subtle.exportKey('raw', k)) as ArrayBuffer);

async function pushEnv(): Promise<AppEnv> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  const d = ((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey).d!;
  return { ...(env as unknown as AppEnv), VAPID_PUBLIC_KEY: b64url(await raw(kp.publicKey)), VAPID_PRIVATE_KEY: d, VAPID_SUBJECT: 'https://example.com' };
}
async function subscribe(cookie: string, tag: string) {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const endpoint = `https://fcm.googleapis.com/fcm/send/${tag}-${crypto.randomUUID()}`;
  const r = await json('POST', '/api/reminders/devices', { cookie, body: { endpoint, keys: { p256dh: b64url(await raw(kp.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } } });
  expect(r.status).toBe(201);
  return endpoint;
}
function fakeFetch(status = 201) {
  const calls: { url: string; headers: Headers; body: Uint8Array; redirect?: RequestInit['redirect'] }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: new Headers(init.headers), body: init.body as Uint8Array, redirect: init.redirect });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const backdate = (id: string) => DB.prepare("UPDATE reminders SET last_sent_at = '2000-01-01T00:00:00.000Z', seen_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(id).run();

describe('reminders CRUD', () => {
  it('create / list / toggle / delete, per user, validated and capped', async () => {
    const o = await ownerSetup();
    const acc = (await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Chk', type: 'checking', bankId: 'leumi' } })).body.id;
    const imp = await json<{ id: string }>('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'import', freq: 'monthly', day: 31, hour: 9, accountId: acc } });
    expect(imp.status).toBe(201);
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 20, weekdays: 31 } })).status).toBe(201);
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'review' } })).status).toBe(201);
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'review' } })).status).toBe(409);
    for (const bad of [{ kind: 'import', freq: 'weekly', day: 7, hour: 9 }, { kind: 'import', freq: 'monthly', day: 0, hour: 9 }, { kind: 'daily', hour: 24 }, { kind: 'daily', hour: 9, extra: 1 }])
      expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: bad })).status, JSON.stringify(bad)).toBe(400);

    const list = await json<RemindersResponse>('GET', '/api/reminders', { cookie: o.cookie });
    expect(list.body.reminders.map((r) => r.kind)).toEqual(['import', 'daily', 'review']);
    expect(list.body.push).toEqual({ available: false, publicKey: null });
    expect(list.body.reminders.every((r) => r.enabled && !r.due)).toBe(true);

    // another member of the same household sees none of them and can't touch them
    const m = await makeUser('M');
    await addMember(o.householdId, m, 'viewer');
    const mc = await sessionFor(m, o.householdId);
    expect((await json<RemindersResponse>('GET', '/api/reminders', { cookie: mc })).body.reminders).toEqual([]);
    expect((await json('PATCH', `/api/reminders/${imp.body.id}`, { cookie: mc, body: { enabled: false } })).status).toBe(404);
    expect((await json('DELETE', `/api/reminders/${imp.body.id}`, { cookie: mc })).status).toBe(404);
    // viewers manage their own
    expect((await json('POST', '/api/reminders', { cookie: mc, body: { kind: 'review' } })).status).toBe(201);

    expect((await json('PATCH', `/api/reminders/${imp.body.id}`, { cookie: o.cookie, body: { enabled: false } })).status).toBe(200);
    expect((await json<RemindersResponse>('GET', '/api/reminders', { cookie: o.cookie })).body.reminders[0]!.enabled).toBe(false);
    expect((await json('DELETE', `/api/reminders/${imp.body.id}`, { cookie: o.cookie })).status).toBe(200);
    expect((await json<RemindersResponse>('GET', '/api/reminders', { cookie: o.cookie })).body.reminders).toHaveLength(2);

    for (let i = 0; i < 18; i++) await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 8 } });
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 8 } })).status).toBe(409);
  });

  it('in-app: a passed slot shows as due until seen', async () => {
    const o = await ownerSetup();
    const id = (await json<{ id: string }>('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 0 } })).body.id;
    await backdate(id);
    expect((await json<RemindersResponse>('GET', '/api/reminders', { cookie: o.cookie })).body.reminders[0]!.due).toBe(true);
    expect((await json('POST', `/api/reminders/${id}/seen`, { cookie: o.cookie })).status).toBe(200);
    expect((await json<RemindersResponse>('GET', '/api/reminders', { cookie: o.cookie })).body.reminders[0]!.due).toBe(false);
  });

  it('devices: endpoint host allow-list, cap of 10, test send without keys is refused', async () => {
    const o = await ownerSetup();
    const bad = await json('POST', '/api/reminders/devices', { cookie: o.cookie, body: { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 10; i++) await subscribe(o.cookie, `d${i}`);
    const r = await json('POST', '/api/reminders/devices', { cookie: o.cookie, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/eleventh', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } });
    expect(r.status).toBe(409);
    expect((await json('POST', '/api/reminders/test', { cookie: o.cookie })).status).toBe(409);
  });
});

describe('scheduled delivery', () => {
  it('sends a due reminder once, to every device, with no amounts in the payload path', async () => {
    const e = await pushEnv();
    const o = await ownerSetup();
    const acc = (await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Chk', type: 'checking', bankId: 'leumi' } })).body.id;
    const id = (await json<{ id: string }>('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'import', freq: 'weekly', day: 0, hour: 9, accountId: acc } })).body.id;
    const ep1 = await subscribe(o.cookie, 'a');
    const ep2 = await subscribe(o.cookie, 'b');
    const { f, calls } = fakeFetch();
    // nothing due yet (created just now)
    await runReminders(e, new Date(), f);
    expect(calls.filter((c) => c.url === ep1 || c.url === ep2)).toHaveLength(0);
    await backdate(id);
    const r1 = await runReminders(e, new Date(), f);
    const mine = () => calls.filter((c) => c.url === ep1 || c.url === ep2);
    expect(mine()).toHaveLength(2);
    expect(r1.sent).toBeGreaterThanOrEqual(2);
    const h = mine()[0]!.headers;
    expect(h.get('content-encoding')).toBe('aes128gcm');
    expect(mine()[0]!.redirect).toBe('manual');
    expect(h.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(mine()[0]!.body.length).toBeGreaterThan(86);
    // next tick: not again
    await runReminders(e, new Date(Date.now() + 15 * 60_000), f);
    expect(mine()).toHaveLength(2);
  });

  it('a transient failure is retried once on the next tick, and the in-app card still shows', async () => {
    const e = await pushEnv();
    const o = await ownerSetup();
    const id = (await json<{ id: string }>('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 0 } })).body.id;
    const ep = await subscribe(o.cookie, 'flaky');
    await backdate(id);
    let n = 0;
    const throwing = (async (url: string) => {
      if (url === ep) n++;
      throw new Error('network');
    }) as unknown as typeof fetch;
    await runReminders(e, new Date(), throwing);
    expect(n).toBe(1);
    expect((await json<RemindersResponse>('GET', '/api/reminders', { cookie: o.cookie })).body.reminders[0]!.due).toBe(true);
    await runReminders(e, new Date(Date.now() + 15 * 60_000), throwing); // the one retry
    expect(n).toBe(2);
    await runReminders(e, new Date(Date.now() + 30 * 60_000), throwing); // no more
    expect(n).toBe(2);
    // a retry that succeeds is not sent again
    await backdate(id);
    const { f, calls } = fakeFetch();
    let fail = true;
    const once = ((url: string, init: RequestInit) => {
      if (fail && url === ep) {
        fail = false;
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return f(url, init);
    }) as unknown as typeof fetch;
    await runReminders(e, new Date(), once);
    await runReminders(e, new Date(Date.now() + 15 * 60_000), once);
    await runReminders(e, new Date(Date.now() + 30 * 60_000), once);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
  });

  it('sign-out unsubscribe removes only the own row for that endpoint', async () => {
    const o = await ownerSetup();
    const ep = await subscribe(o.cookie, 'out');
    const other = await ownerSetup('Other', 'Other home');
    expect((await json('POST', '/api/reminders/devices/unsubscribe', { cookie: other.cookie, body: { endpoint: ep } })).status).toBe(200);
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?1').bind(ep).first<{ n: number }>())!.n).toBe(1);
    expect((await json('POST', '/api/reminders/devices/unsubscribe', { cookie: o.cookie, body: { endpoint: ep } })).status).toBe(200);
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?1').bind(ep).first<{ n: number }>())!.n).toBe(0);
  });

  it('removes subscriptions the push service reports gone (410)', async () => {
    const e = await pushEnv();
    const o = await ownerSetup();
    const id = (await json<{ id: string }>('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'daily', hour: 0 } })).body.id;
    await subscribe(o.cookie, 'gone');
    await backdate(id);
    const { f } = fakeFetch(410);
    await runReminders(e, new Date(), f);
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1').bind(o.userId).first<{ n: number }>())!.n).toBe(0);
  });

  it('review-ready fires once per month', async () => {
    const e = await pushEnv();
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    await DB.prepare('DELETE FROM reviews WHERE household_id = ?1').bind(o.householdId).run(); // the demo ships its latest review completed
    await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'review' } });
    const ep = await subscribe(o.cookie, 'rev');
    const { f, calls } = fakeFetch();
    const noon = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00Z`); // 12:00/13:00 in Israel
    await runReminders(e, noon, f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
    const month = (await DB.prepare('SELECT review_month FROM reminders WHERE user_id = ?1').bind(o.userId).first<{ review_month: string }>())!.review_month;
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    await DB.prepare('UPDATE reminders SET checked_at = NULL WHERE user_id = ?1').bind(o.userId).run();
    await runReminders(e, noon, f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
  });

  it('budget alerts: one push when a budget passes a threshold, not again for the same threshold', async () => {
    const e = await pushEnv();
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    await DB.prepare('DELETE FROM reminders').run(); // other households' reminders would share this tick
    const noon = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00Z`);
    const b = (await json<{ month: string; lines: { categoryId: string; spentMinor: number; limitMinor: number | null }[] }>('GET', '/api/budgets', { cookie: o.cookie })).body;
    const line = b.lines.filter((l) => l.categoryId !== 'general').sort((x, y) => y.spentMinor - x.spentMinor)[0]!;
    expect(line.spentMinor).toBeGreaterThan(0);
    expect((await json('PUT', '/api/budgets', { cookie: o.cookie, body: { month: b.month, items: [{ categoryId: line.categoryId, limitMinor: 100, oneTime: true }] } })).status).toBe(200);
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'budget' } })).status).toBe(201);
    expect((await json('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'budget' } })).status).toBe(409); // one per user
    const ep = await subscribe(o.cookie, 'bud');
    const { f, calls } = fakeFetch();
    await runReminders(e, noon, f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
    const marks = JSON.parse((await DB.prepare('SELECT marks FROM reminders WHERE user_id = ?1').bind(o.userId).first<{ marks: string }>())!.marks) as { keys: string[] };
    expect(marks.keys).toContain(`${line.categoryId}:100`);
    // next hourly check: nothing new to say
    await DB.prepare('UPDATE reminders SET checked_at = NULL WHERE user_id = ?1').bind(o.userId).run();
    await runReminders(e, noon, f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
    // never at night
    await DB.prepare('UPDATE reminders SET checked_at = NULL, marks = NULL WHERE user_id = ?1').bind(o.userId).run();
    await runReminders(e, new Date(`${new Date().toISOString().slice(0, 10)}T22:00:00Z`), f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
  });

  it('weekly recap: pushed on its day once, and the in-app card has the week', async () => {
    const e = await pushEnv();
    const o = await ownerSetup();
    await json('POST', '/api/household/sample-data', { cookie: o.cookie });
    await DB.prepare('DELETE FROM reminders').run();
    const noon = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00Z`);
    const weekday = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(noon) + 'T00:00:00Z').getUTCDay();
    const rem = await json<{ id: string }>('POST', '/api/reminders', { cookie: o.cookie, body: { kind: 'recap', day: weekday, hour: 9 } });
    expect(rem.status).toBe(201);
    await backdate(rem.body.id);
    const ep = await subscribe(o.cookie, 'recap');
    const { f, calls } = fakeFetch();
    await runReminders(e, noon, f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
    await runReminders(e, new Date(noon.getTime() + 15 * 60_000), f);
    expect(calls.filter((c) => c.url === ep)).toHaveLength(1);
    const w = (await json<{ from: string; to: string; spentMinor: number; top: unknown[] }>('GET', '/api/dashboard/week', { cookie: o.cookie })).body;
    expect(w.spentMinor).toBeGreaterThanOrEqual(0);
    expect(w.from < w.to).toBe(true);
  });
});
