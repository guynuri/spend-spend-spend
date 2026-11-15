import { z } from 'zod';
import { tenantGroup } from './tenant';
import type { Ctx } from '../types';
import { tctx, originOf } from '../ctx';
import { HttpError, body, notFound } from '../http';
import { requireOwner } from '../middleware/auth';
import { randomToken, sha256Hex } from '../lib/crypto';
import { INVITE_TTL_MS, RECOVERY_TTL_MS } from './auth';
import { sendInviteEmail } from '../lib/email';
import { roleSchema } from '../../shared/schemas/me';
import { buildDemoFor, demoInsertStatements } from '../seed/insert';
import { householdToday } from '../lib/today';

export const householdRoutes = tenantGroup();

const members = (c: Ctx) => tctx(c).db.members;

householdRoutes.get('/', (c) => {
  const { hh, role } = tctx(c);
  return c.json({
    id: hh.id,
    name: hh.name,
    currency: hh.currency,
    timezone: hh.timezone,
    safetyBufferMinor: hh.safety_buffer_minor,
    forecastDailyVariableMinor: hh.forecast_daily_variable_minor,
    hasSampleData: hh.has_sample_data === 1,
    aiEnabled: hh.ai_enabled === 1,
    aiConsentAt: hh.ai_consent_at,
    role,
  });
});

householdRoutes.patch('/', requireOwner, async (c) => {
  const b = await body(
    c,
    z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        timezone: z.string().min(3).max(60).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }).optional(),
        safetyBufferMinor: z.number().int().min(0).max(1e11).optional(),
        forecastDailyVariableMinor: z.number().int().min(0).max(1e9).nullable().optional(),
      })
      .strict(),
  );
  const { db, userId } = tctx(c);
  await members(c).update({ ...b, clearDailyVariable: b.forecastDailyVariableMinor === null, forecastDailyVariableMinor: b.forecastDailyVariableMinor ?? undefined });
  await db.audit(userId, 'household.update', 'household', db.householdId).run();
  return c.json({ ok: true });
});

householdRoutes.get('/members', async (c) => {
  const rows = await members(c).list();
  return c.json({ members: rows.map((m) => ({ userId: m.id, displayName: m.display_name, role: m.role, joinedAt: m.created_at, passkeys: m.passkeys })) });
});

householdRoutes.patch('/members/:userId', requireOwner, async (c) => {
  const b = await body(c, z.object({ role: roleSchema }).strict());
  const m = members(c);
  const uid = c.req.param('userId');
  const cur = await m.roleOf(uid);
  if (!cur) throw notFound();
  if (cur === 'owner' && b.role !== 'owner' && (await m.countOwners()) <= 1) throw new HttpError(409, 'last_owner', 'The last owner cannot be demoted');
  await m.setRole(uid, b.role);
  const { db, userId } = tctx(c);
  await db.audit(userId, 'member.role', 'user', uid, { role: b.role }).run();
  return c.json({ ok: true });
});

householdRoutes.delete('/members/:userId', requireOwner, async (c) => {
  const m = members(c);
  const uid = c.req.param('userId');
  const cur = await m.roleOf(uid);
  if (!cur) throw notFound();
  if (cur === 'owner' && (await m.countOwners()) <= 1) throw new HttpError(409, 'last_owner', 'The last owner cannot be removed');
  await m.remove(uid);
  const { db, userId } = tctx(c);
  await db.audit(userId, 'member.remove', 'user', uid).run();
  return c.json({ ok: true });
});

householdRoutes.get('/invites', requireOwner, async (c) => {
  const rows = await members(c).invites();
  return c.json({ invites: rows.map((i) => ({ id: i.id, kind: i.kind, role: i.role, email: i.email, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at })) });
});

householdRoutes.post('/invites', requireOwner, async (c) => {
  const b = await body(c, z.object({ role: z.enum(['member', 'viewer']), email: z.string().email().max(120).optional(), note: z.string().trim().max(60).optional() }).strict());
  const { hh, userId, db } = tctx(c);
  const token = randomToken();
  const id = await members(c).createInvite({ tokenHash: await sha256Hex(token), kind: 'member', role: b.role, email: b.email ?? null, note: b.note ?? null, createdBy: userId, ttlMs: INVITE_TTL_MS });
  const link = `${originOf(c)}/invite#${token}`;
  const emailed = b.email ? await sendInviteEmail(c.env, b.email, link, hh.name) : false;
  await db.audit(userId, 'invite.create', 'invite', id, { role: b.role }).run();
  return c.json({ id, link, emailed }, 201);
});

householdRoutes.delete('/invites/:id', requireOwner, async (c) => {
  const r = await members(c).revokeInvite(c.req.param('id'));
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

householdRoutes.post('/members/:userId/recovery', requireOwner, async (c) => {
  const uid = c.req.param('userId');
  const m = members(c);
  if (!(await m.roleOf(uid))) throw notFound();
  const { userId, db } = tctx(c);
  const token = randomToken();
  await m.createInvite({ tokenHash: await sha256Hex(token), kind: 'recovery', role: null, targetUserId: uid, createdBy: userId, ttlMs: RECOVERY_TTL_MS });
  await db.audit(userId, 'member.recovery', 'user', uid).run();
  return c.json({ link: `${originOf(c)}/recover#${token}` }, 201);
});

/** Loads the sample household (empty households only, AC14.1). */
householdRoutes.post('/sample-data', requireOwner, async (c) => {
  const { db, hh, userId } = tctx(c);
  const used = await db.first<{ n: number }>('SELECT (SELECT COUNT(*) FROM accounts WHERE household_id = ?1) + (SELECT COUNT(*) FROM transactions WHERE household_id = ?1) AS n');
  if (used!.n > 0) throw new HttpError(409, 'not_empty', 'Household already has data');
  const loc = (c.req.header('x-mz-locale') === 'he' ? 'he' : c.req.header('x-mz-locale') === 'en' ? 'en' : hh.locale === 'he' ? 'he' : 'en') as 'en' | 'he';
  const data = await buildDemoFor(db, householdToday(hh), loc);
  await db.batch([...demoInsertStatements(db, data), db.members.setSampleDataStmt(true), db.audit(userId, 'household.sample_data', 'household', hh.id)]);
  return c.json({ ok: true, transactions: data.transactions.length }, 201);
});
