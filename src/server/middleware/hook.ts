import type { Context } from 'hono';
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
  c.set('userId', key.user_id);
  return { db: tenantDb(c.env.DB, hh.id), hh, userId: key.user_id };
}
