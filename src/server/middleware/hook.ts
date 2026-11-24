import type { Context, MiddlewareHandler } from 'hono';
import type { AppCtx } from '../types';
import type { HouseholdRow } from '../db/rows';
import { HttpError } from '../http';
import { globalDb } from '../db/global';
import { tenantDb, type TenantDb } from '../db/tenant';
import { sha256Hex } from '../lib/crypto';
import { assertTokenAttemptsLeft, recordTokenFailure } from './auth';

/**
 * Phone-automation hooks (D-R20): a bearer key → household + user, checked like an invite token (failures
 * count toward the IP limit). The key stops working once revoked, once its user leaves the household or
 * becomes a viewer, or while the household is disabled.
 */
export async function hookAuth(c: Context<AppCtx>): Promise<{ db: TenantDb; hh: HouseholdRow; userId: string }> {
  const token = /^Bearer\s+(\S{20,100})$/.exec(c.req.header('authorization') ?? '')?.[1];
  await assertTokenAttemptsLeft(c);
  const g = globalDb(c.env.DB);
  const key = token ? await g.captureKey(await sha256Hex(token)) : null;
  if (!key) {
    await recordTokenFailure(c);
    throw new HttpError(401, 'invalid_key', 'Unknown or revoked key');
  }
  if (key.role === 'viewer') throw new HttpError(403, 'forbidden_role', 'Viewers cannot add transactions');
  const hh = await g.getHousehold(key.household_id);
  if (!hh || hh.status !== 'active') throw new HttpError(403, 'household_disabled', 'Household disabled');
  await g.touchCaptureKey(key.id);
  c.set('captureKeyId', key.id);
  c.set('userId', key.user_id);
  return { db: tenantDb(c.env.DB, hh.id), hh, userId: key.user_id };
}

/**
 * Every hook answer carries a top-level `message` (errors too), so the shortcut's "Get Dictionary Value
 * message" → "Show Notification" always says what happened; and the key remembers what its last request
 * came to (D-R32), so Settings can tell "the phone never reached the app" from "it sent something unreadable".
 */
export const hookResult: MiddlewareHandler<AppCtx> = async (c, next) => {
  await next();
  type Out = { status?: string; message?: string; error?: { code?: string; message?: string } };
  let body: Out | null = null;
  try {
    body = (await c.res.clone().json()) as Out;
  } catch {
    /* not JSON */
  }
  if (body?.error && !body.message) {
    const { status, headers } = c.res;
    c.res = new Response(JSON.stringify({ status: 'error', code: body.error.code, message: body.error.message, error: body.error }), { status, headers });
  }
  const id = c.get('captureKeyId');
  if (id) await globalDb(c.env.DB).captureKeyResult(id, body?.error?.code ?? body?.status ?? String(c.res.status), c.get('hookDetail') ?? null);
};
