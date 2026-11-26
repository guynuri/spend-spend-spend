import { Hono } from 'hono';
import { z } from 'zod';
import type { AppCtx, Ctx } from '../types';
import { globalDb } from '../db/global';
import { householdInitStatements } from '../db/householdInit';
import { tenantDb } from '../db/tenant';
import { HttpError, body, notFound } from '../http';
import { checkShortcut } from '../lib/shortcutCheck';
import { SHORTCUT_LINK_RE } from '../../shared/shortcuts';
import { newId, randomToken, sha256Hex } from '../lib/crypto';
import { requireSuperAdmin } from '../middleware/auth';
import { INVITE_TTL_MS, RECOVERY_TTL_MS } from './auth';
import { originOf } from '../ctx';
import { sendInviteEmail } from '../lib/email';
import { isDemoHousehold } from '../seed/demoHousehold';

/** Super-admin: household METADATA only (PLAN §6.4, D-17). */
export const adminRoutes = new Hono<AppCtx>();
adminRoutes.use('/admin/*', requireSuperAdmin);

adminRoutes.get('/admin/households', async (c) => {
  const rows = await globalDb(c.env.DB).adminHouseholds();
  return c.json({
    households: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      memberCount: r.member_count,
      createdAt: r.created_at,
      lastImportAt: r.last_import_at,
      owners: (JSON.parse(r.owners_json || '[]') as { id: string; name: string }[]).filter((o) => o.id),
    })),
  });
});

async function ownerInvite(c: Ctx, householdId: string, email?: string | null) {
  const g = globalDb(c.env.DB);
  const token = randomToken();
  await g.createInvite({ tokenHash: await sha256Hex(token), kind: 'owner', householdId, role: 'owner', email: email ?? null, createdBy: c.get('userId')!, ttlMs: INVITE_TTL_MS });
  const link = `${originOf(c)}/invite#${token}`;
  let emailed = false;
  if (email) emailed = await sendInviteEmail(c.env, email, link, (await g.getHousehold(householdId))?.name ?? '');
  return { link, emailed, expiresInDays: 7 };
}

adminRoutes.post('/admin/households', async (c) => {
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(60), locale: z.enum(['en', 'he']).optional(), email: z.string().email().max(120).optional() }).strict());
  const g = globalDb(c.env.DB);
  const id = newId();
  const loc = b.locale ?? (c.env.DEFAULT_LOCALE === 'he' ? 'he' : 'en');
  await c.env.DB.batch([
    g.createHouseholdStmt({ id, name: b.name, createdBy: c.get('userId')!, locale: loc }),
    ...householdInitStatements(c.env.DB, id, loc),
    tenantDb(c.env.DB, id).audit(c.get('userId')!, 'admin.household.create', 'household', id),
  ]);
  return c.json({ id, invite: await ownerInvite(c, id, b.email) }, 201);
});

adminRoutes.patch('/admin/households/:id', async (c) => {
  const b = await body(c, z.object({ status: z.enum(['active', 'disabled']).optional(), name: z.string().trim().min(1).max(60).optional() }).strict());
  const g = globalDb(c.env.DB);
  const id = c.req.param('id');
  if (isDemoHousehold(id) || !(await g.getHousehold(id))) throw notFound();
  if (b.status) await g.setHouseholdStatus(id, b.status);
  if (b.name) await g.updateHousehold(id, { name: b.name });
  await tenantDb(c.env.DB, id).audit(c.get('userId')!, 'admin.household.update', 'household', id, { status: b.status ?? null }).run();
  return c.json({ ok: true });
});

adminRoutes.post('/admin/households/:id/owner-invite', async (c) => {
  const id = c.req.param('id');
  // The tour's shared demo households never get owners (see also migration 0014).
  if (isDemoHousehold(id) || !(await globalDb(c.env.DB).getHousehold(id))) throw notFound();
  return c.json({ invite: await ownerInvite(c, id) }, 201);
});

adminRoutes.post('/admin/users/:id/recovery', async (c) => {
  const g = globalDb(c.env.DB);
  const uid = c.req.param('id');
  if (!(await g.getUser(uid))) throw notFound();
  const token = randomToken();
  await g.createInvite({ tokenHash: await sha256Hex(token), kind: 'recovery', householdId: null, role: null, targetUserId: uid, createdBy: c.get('userId')!, ttlMs: RECOVERY_TTL_MS });
  return c.json({ link: `${originOf(c)}/recover#${token}` }, 201);
});

/** App-wide settings (D-R34): the shared Shortcuts every household without its own is offered. */
adminRoutes.get('/admin/settings', async (c) => c.json({ shortcutLinks: await globalDb(c.env.DB).appShortcutLinks() }));

adminRoutes.patch('/admin/settings', async (c) => {
  const link = z.string().regex(SHORTCUT_LINK_RE).nullable().optional();
  const b = await body(c, z.object({ shortcutPurchaseLink: link, shortcutFileLink: link }).strict());
  // iCloud links are public, so no one's key may be inside; and unlike a household's own link this one
  // reaches every household, so it must be verified: if iCloud can't be read, refuse (try again later)
  if (c.env.SHORTCUT_CHECK !== 'skip')
    for (const l of [b.shortcutPurchaseLink, b.shortcutFileLink]) {
      if (!l) continue;
      const r = await checkShortcut(l);
      if (r === 'key') throw new HttpError(400, 'shortcut_has_key', 'This shortcut has a personal key inside');
      if (r === 'unverified') throw new HttpError(503, 'shortcut_unverified', 'Could not check the shortcut with iCloud');
    }
  await globalDb(c.env.DB).setAppShortcutLinks({ purchase: b.shortcutPurchaseLink, file: b.shortcutFileLink }, c.get('userId')!);
  // audit_log is per household; an app-wide change goes to the Worker's logs (app_settings keeps who/when for the current value)
  console.warn(JSON.stringify({ rid: c.get('rid'), event: 'admin.settings.update', by: c.get('userId'), purchase: b.shortcutPurchaseLink, file: b.shortcutFileLink }));
  return c.json({ ok: true });
});
