import { describe, expect, it } from 'vitest';
import { DB, json, makeUser, ownerSetup, sessionFor } from './helpers';

type Links = { purchase: string | null; file: string | null };
const A = 'https://www.icloud.com/shortcuts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'https://www.icloud.com/shortcuts/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const F = 'https://www.icloud.com/shortcuts/ffffffffffffffffffffffffffffffff';

describe('app-wide shared shortcuts (D-R34)', () => {
  it('the super-admin sets them once; every household without its own gets them; its own wins', async () => {
    await DB.prepare('DELETE FROM app_settings').run();
    const admin = await sessionFor(await makeUser('Root', true), null);
    const o = await ownerSetup('Dana');
    const household = async () => (await json<{ shortcutLinks: Links; shortcutLinksOwn: Links }>('GET', '/api/household', { cookie: o.cookie })).body;

    // only the super-admin
    expect((await json('GET', '/api/admin/settings', { cookie: o.cookie })).status).toBe(403);
    expect((await json('PATCH', '/api/admin/settings', { cookie: o.cookie, body: { shortcutPurchaseLink: A } })).status).toBe(403);
    expect((await json('PATCH', '/api/admin/settings', { cookie: admin, body: { shortcutPurchaseLink: 'https://evil.example/x' } })).status).toBe(400);

    expect((await household()).shortcutLinks).toEqual({ purchase: null, file: null });
    expect((await json('PATCH', '/api/admin/settings', { cookie: admin, body: { shortcutPurchaseLink: A, shortcutFileLink: F } })).status).toBe(200);
    expect((await json<{ shortcutLinks: Links }>('GET', '/api/admin/settings', { cookie: admin })).body.shortcutLinks).toEqual({ purchase: A, file: F });
    // a household that never published one now offers the app's
    expect(await household()).toMatchObject({ shortcutLinks: { purchase: A, file: F }, shortcutLinksOwn: { purchase: null, file: null } });

    // the household's own link wins for that household; removing it falls back to the app's
    await json('PATCH', '/api/household', { cookie: o.cookie, body: { shortcutPurchaseLink: B } });
    expect(await household()).toMatchObject({ shortcutLinks: { purchase: B, file: F }, shortcutLinksOwn: { purchase: B, file: null } });
    await json('PATCH', '/api/household', { cookie: o.cookie, body: { shortcutPurchaseLink: null } });
    expect((await household()).shortcutLinks.purchase).toBe(A);

    // changing one app link keeps the other; null removes it
    await json('PATCH', '/api/admin/settings', { cookie: admin, body: { shortcutPurchaseLink: null } });
    expect((await json<{ shortcutLinks: Links }>('GET', '/api/admin/settings', { cookie: admin })).body.shortcutLinks).toEqual({ purchase: null, file: F });
    expect((await household()).shortcutLinks).toEqual({ purchase: null, file: F });
    await DB.prepare('DELETE FROM app_settings').run();
  });
});
