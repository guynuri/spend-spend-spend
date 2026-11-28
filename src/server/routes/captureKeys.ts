/**
 * Personal keys for the phone automations (D-R20), per user inside their active household. A key can
 * only add purchases / import files through /api/hook/*; it is shown once and stored as SHA-256.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppCtx } from '../types';
import { household } from '../middleware/auth';
import { tctx } from '../ctx';
import { body, HttpError, notFound } from '../http';
import { newId, nowIso, randomToken, sha256Hex } from '../lib/crypto';
import { text } from '../../shared/schemas/common';

export const captureKeyRoutes = new Hono<AppCtx>();
captureKeyRoutes.use('*', household);
// adding transactions needs a member; a viewer has nothing a key could do
captureKeyRoutes.use('*', async (c, next) => {
  if (c.get('role') === 'viewer') throw new HttpError(403, 'forbidden_role', 'Viewers cannot add transactions');
  await next();
});

export const MAX_KEYS = 5;

function recentOf(raw: string | null): CaptureKey['recent'] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? (v as CaptureKey['recent']).slice(0, 5) : [];
  } catch {
    return [];
  }
}
export interface CaptureKey {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** What the last request with this key came to ('added', 'test', 'unreadable_purchase', …) and what it carried. */
  lastResult: string | null;
  lastDetail: string | null;
  /** The last 5 attempts, newest first (D-R35). */
  recent: { at: string; result: string; detail: string | null }[];
}

captureKeyRoutes.get('/', async (c) => {
  const { db, userId } = tctx(c);
  const rows = await db.all<{ id: string; label: string | null; created_at: string; last_used_at: string | null; last_result: string | null; last_detail: string | null; recent_json: string | null }>(
    'SELECT id, label, created_at, last_used_at, last_result, last_detail, recent_json FROM capture_keys WHERE household_id = ?1 AND user_id = ?2 AND revoked_at IS NULL ORDER BY created_at',
    userId,
  );
  return c.json({ keys: rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, lastResult: r.last_result, lastDetail: r.last_detail, recent: recentOf(r.recent_json) }) satisfies CaptureKey) });
});

captureKeyRoutes.post('/', async (c) => {
  const b = await body(c, z.object({ label: text(60).optional() }).strict());
  const { db, userId } = tctx(c);
  const n = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM capture_keys WHERE household_id = ?1 AND user_id = ?2 AND revoked_at IS NULL', userId);
  if ((n?.n ?? 0) >= MAX_KEYS) throw new HttpError(409, 'too_many_keys', 'Too many keys');
  const token = `mz_${randomToken()}`;
  const id = newId();
  await db.batch([
    db.insertStmt('capture_keys', { id, user_id: userId, token_hash: await sha256Hex(token), label: b.label?.trim() || null, created_at: nowIso() }),
    db.audit(userId, 'capture_key.create', 'capture_key', id),
  ]);
  // the only time the key is ever shown
  return c.json({ id, token }, 201);
});

captureKeyRoutes.delete('/:id', async (c) => {
  const { db, userId } = tctx(c);
  const r = await db.run('UPDATE capture_keys SET revoked_at = ?3 WHERE household_id = ?1 AND id = ?2 AND user_id = ?4 AND revoked_at IS NULL', c.req.param('id'), nowIso(), userId);
  if (!r.meta.changes) throw notFound();
  await db.audit(userId, 'capture_key.revoke', 'capture_key', c.req.param('id')).run();
  return c.json({ ok: true });
});
