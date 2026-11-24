import { describe, expect, it } from 'vitest';
import { DB, addMember, json, makeUser, ownerSetup, sessionFor } from './helpers';

type Me = { user: { homeWidgets: string[] | null; theme: string | null } };

describe('customizable Home (D-R31)', () => {
  it('saves the layout on the user (any role), keeps other prefs, and null resets it', async () => {
    const o = await ownerSetup('Dana');
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toBeNull();
    expect((await json('PATCH', '/api/me', { cookie: o.cookie, body: { theme: 'dark' } })).status).toBe(200);
    expect((await json('PATCH', '/api/me', { cookie: o.cookie, body: { homeWidgets: ['recent', 'donut'] } })).status).toBe(200);
    let me = (await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user;
    expect(me.homeWidgets).toEqual(['recent', 'donut']);
    expect(me.theme).toBe('dark');
    // other profile changes leave the layout alone
    await json('PATCH', '/api/me', { cookie: o.cookie, body: { theme: 'light' } });
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toEqual(['recent', 'donut']);
    // an empty Home is allowed
    await json('PATCH', '/api/me', { cookie: o.cookie, body: { homeWidgets: [] } });
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toEqual([]);
    await json('PATCH', '/api/me', { cookie: o.cookie, body: { homeWidgets: null } });
    me = (await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user;
    expect(me.homeWidgets).toBeNull();
    expect(me.theme).toBe('light');

    // a viewer arranges their own Home too; it doesn't touch anyone else's
    const v = await makeUser('Viewer');
    await addMember(o.householdId, v, 'viewer');
    const vc = await sessionFor(v, o.householdId);
    expect((await json('PATCH', '/api/me', { cookie: vc, body: { homeWidgets: ['hero'] } })).status).toBe(200);
    expect((await json<Me>('GET', '/api/me', { cookie: vc })).body.user.homeWidgets).toEqual(['hero']);
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toBeNull();
  });

  it('refuses unknown or repeated widgets, and drops ids it no longer knows when reading', async () => {
    const o = await ownerSetup('Dana');
    expect((await json('PATCH', '/api/me', { cookie: o.cookie, body: { homeWidgets: ['nope'] } })).status).toBe(400);
    expect((await json('PATCH', '/api/me', { cookie: o.cookie, body: { homeWidgets: ['hero', 'hero'] } })).status).toBe(400);
    await DB.prepare('UPDATE users SET home_widgets = ?2 WHERE id = ?1').bind(o.userId, JSON.stringify(['old-widget', 'goals'])).run();
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toEqual(['goals']);
    await DB.prepare('UPDATE users SET home_widgets = ?2 WHERE id = ?1').bind(o.userId, '{}').run();
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toBeNull();
    await DB.prepare('UPDATE users SET home_widgets = ?2 WHERE id = ?1').bind(o.userId, 'not json').run();
    expect((await json<Me>('GET', '/api/me', { cookie: o.cookie })).body.user.homeWidgets).toBeNull();
  });
});
