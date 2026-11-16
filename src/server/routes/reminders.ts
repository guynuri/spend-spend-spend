/**
 * Reminders and push devices of the signed-in user, inside their active household. Per user, so any
 * role (viewers too) manages their own; every query is scoped to household AND user.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppCtx, Ctx } from '../types';
import { household, rateLimit } from '../middleware/auth';
import { tctx } from '../ctx';
import { body, HttpError, notFound } from '../http';
import { newId, nowIso } from '../lib/crypto';
import { vapidKeys } from '../lib/webpush';
import { isDemoHousehold } from '../seed/demoHousehold';
import { pushMessage, sendAll } from '../db/reminders';
import { endpointSchema, isDue, MAX_DEVICES, MAX_REMINDERS, reminderInputSchema, subscriptionSchema, type Reminder, type RemindersResponse } from '../../shared/reminders';

export const reminderRoutes = new Hono<AppCtx>();
reminderRoutes.use('*', household);

interface Row {
  id: string;
  kind: Reminder['kind'];
  freq: Reminder['freq'];
  day: number | null;
  weekdays: number;
  hour: number;
  account_id: string | null;
  enabled: number;
  seen_at: string;
}

reminderRoutes.get('/', async (c) => {
  const { db, hh, userId } = tctx(c);
  const rows = await db.all<Row>('SELECT * FROM reminders WHERE household_id = ?1 AND user_id = ?2 ORDER BY created_at', userId);
  const now = new Date();
  const keys = vapidKeys(c.env);
  const res: RemindersResponse = {
    reminders: rows.map((r) => ({ id: r.id, kind: r.kind, freq: r.freq, day: r.day, weekdays: r.weekdays, hour: r.hour, accountId: r.account_id, enabled: r.enabled === 1, due: r.enabled === 1 && isDue(r, hh.timezone, now, r.seen_at) })),
    push: { available: !!keys, publicKey: keys?.publicKey ?? null },
    // Tour demo mode reads the shared demo household: never show this user's real devices there.
    devices: keys && !isDemoHousehold(hh.id) ? (await db.pushOf(userId).list()).map((d) => ({ id: d.id, endpoint: d.endpoint, label: d.label, createdAt: d.created_at })) : [],
  };
  return c.json(res);
});

// device routes before /:id
reminderRoutes.post('/devices', async (c) => {
  const { db, userId } = tctx(c);
  const s = await body(c, subscriptionSchema);
  const push = db.pushOf(userId);
  if (!(await push.exists(s.endpoint)) && (await push.count()) >= MAX_DEVICES) throw new HttpError(409, 'too_many_devices', 'Too many devices');
  await push.save({ endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, label: s.label ?? null });
  return c.json({ ok: true }, 201);
});

/** Sign-out: this browser stops receiving the user's reminders. */
reminderRoutes.post('/devices/unsubscribe', async (c) => {
  const { db, userId } = tctx(c);
  const { endpoint } = await body(c, endpointSchema);
  await db.pushOf(userId).removeEndpoint(endpoint);
  return c.json({ ok: true });
});

reminderRoutes.delete('/devices/:id', async (c) => {
  const { db, userId } = tctx(c);
  if (!(await db.pushOf(userId).remove(c.req.param('id')))) throw notFound();
  return c.json({ ok: true });
});

reminderRoutes.post('/test', async (c, next) => rateLimit('pushtest', 5, 10 * 60_000)(c, next), async (c) => {
  const { db, userId } = tctx(c);
  const keys = vapidKeys(c.env);
  if (!keys) throw new HttpError(409, 'push_unavailable', 'Push is not configured');
  const push = db.pushOf(userId);
  const subs = await push.list();
  const loc = c.req.header('x-mz-locale') ?? null;
  const r = await sendAll(keys, subs, pushMessage('test', loc, '/settings', 'test'));
  for (const id of r.gone) await push.remove(id);
  return c.json({ sent: r.sent, gone: r.gone.length });
});

reminderRoutes.post('/', async (c) => {
  const { db, userId } = tctx(c);
  const r = await body(c, reminderInputSchema);
  const counts = await db.first<{ n: number; review: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(kind = 'review'), 0) AS review FROM reminders WHERE household_id = ?1 AND user_id = ?2", userId);
  if ((counts?.n ?? 0) >= MAX_REMINDERS) throw new HttpError(409, 'too_many_reminders', 'Too many reminders');
  if (r.kind === 'review' && counts?.review) throw new HttpError(409, 'duplicate', 'Already exists');
  const accountId = r.kind === 'import' ? (r.accountId ?? null) : null;
  await db.assertOwned({ accounts: [accountId] });
  const id = newId();
  const now = nowIso();
  await db.insert('reminders', {
    id,
    user_id: userId,
    kind: r.kind,
    freq: r.kind === 'import' ? r.freq : null,
    day: r.kind === 'import' ? r.day : null,
    weekdays: r.kind === 'daily' ? (r.weekdays ?? 127) : 127,
    hour: r.kind === 'review' ? 9 : r.hour,
    account_id: accountId,
    last_sent_at: now,
    seen_at: now,
    created_at: now,
  });
  return c.json({ id }, 201);
});

const own = async (c: Ctx) => {
  const { db, userId } = tctx(c);
  const id = c.req.param('id')!;
  if (!(await db.first('SELECT 1 AS x FROM reminders WHERE household_id = ?1 AND user_id = ?2 AND id = ?3', userId, id))) throw notFound();
  return { db, userId, id };
};

/** Enable / disable. Re-enabling starts fresh: slots missed while off neither push nor show. */
reminderRoutes.patch('/:id', async (c) => {
  const { db, userId, id } = await own(c);
  const p = await body(c, z.object({ enabled: z.boolean() }).strict());
  const now = nowIso();
  await db.run('UPDATE reminders SET enabled = ?3, last_sent_at = ?4, seen_at = ?4 WHERE household_id = ?1 AND user_id = ?2 AND id = ?5', userId, p.enabled ? 1 : 0, now, id);
  return c.json({ ok: true });
});

reminderRoutes.delete('/:id', async (c) => {
  const { db, userId, id } = await own(c);
  await db.run('DELETE FROM reminders WHERE household_id = ?1 AND user_id = ?2 AND id = ?3', userId, id);
  return c.json({ ok: true });
});

/** The in-app card was opened or dismissed. */
reminderRoutes.post('/:id/seen', async (c) => {
  const { db, userId, id } = await own(c);
  await db.run('UPDATE reminders SET seen_at = ?3 WHERE household_id = ?1 AND user_id = ?2 AND id = ?4', userId, nowIso(), id);
  return c.json({ ok: true });
});
