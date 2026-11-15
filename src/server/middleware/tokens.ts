import type { Context } from 'hono';
import type { AppCtx } from '../types';
import { globalDb, type InviteRow } from '../db/global';
import { HttpError } from '../http';
import { safeEqual, sha256Hex } from '../lib/crypto';
import { assertTokenAttemptsLeft, recordTokenFailure } from './auth';

export type ResolvedToken = { kind: 'bootstrap'; invite: null } | { kind: 'owner' | 'member' | 'recovery'; invite: InviteRow };

/** Resolves a setup/invite/recovery token. Any problem → 410 `invite_invalid` (and counted). */
export async function resolveToken(c: Context<AppCtx>, token: string): Promise<ResolvedToken> {
  await assertTokenAttemptsLeft(c);
  const g = globalDb(c.env.DB);
  const fail = async (): Promise<never> => {
    await recordTokenFailure(c);
    throw new HttpError(410, 'invite_invalid', 'Link is invalid, used or expired');
  };
  if (!token || token.length > 200) return fail();
  const boot = c.env.BOOTSTRAP_TOKEN;
  if (boot && boot.length >= 8 && (await safeEqual(token, boot))) {
    if (await g.hasSuperAdmin()) return fail();
    return { kind: 'bootstrap', invite: null };
  }
  const inv = await g.inviteByHash(await sha256Hex(token));
  if (!inv || inv.kind === 'bootstrap' || inv.used_at || inv.revoked_at || inv.expires_at < new Date().toISOString()) return fail();
  return { kind: inv.kind, invite: inv };
}
