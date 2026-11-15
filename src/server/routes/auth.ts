import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { APP_NAME } from '../../shared/app';
import { todayInTz } from '../../shared/dates';
import { patchMeSchema, type MeResponse } from '../../shared/schemas/me';
import type { AppCtx } from '../types';
import { globalDb } from '../db/global';
import { householdInitStatements } from '../db/householdInit';
import { tenantDb } from '../db/tenant';
import { HttpError, body, badRequest, notFound } from '../http';
import { DAY_MS, newId } from '../lib/crypto';
import { clearSessionCookie, newSession, requireSession } from '../middleware/auth';
import { resolveToken } from '../middleware/tokens';
import { getProvider } from '../ai/provider';
import { loadBadges } from '../db/badges';

const enc = new TextEncoder();
const locale = z.enum(['en', 'he']).optional();

function rp(c: Context<AppCtx>) {
  const url = new URL(c.req.url);
  if (c.env.APP_HOST && url.hostname !== c.env.APP_HOST) throw new HttpError(400, 'wrong_host', 'Wrong host');
  return { rpID: url.hostname, origin: url.origin };
}

const regOptionsSchema = z.object({ token: z.string().min(1).max(200), displayName: z.string().trim().min(1).max(60).optional(), householdName: z.string().trim().min(1).max(60).optional(), locale }).strict();
const regVerifySchema = z
  .object({ token: z.string().min(1).max(200), challengeId: z.string().min(1).max(40), response: z.record(z.string(), z.unknown()), householdName: z.string().trim().min(1).max(60).optional(), locale, deviceLabel: z.string().trim().max(60).optional() })
  .strict();
const loginVerifySchema = z.object({ challengeId: z.string().min(1).max(40), response: z.record(z.string(), z.unknown()) }).strict();
const tokenSchema = z.object({ token: z.string().min(1).max(200) }).strict();

function registrationOptions(c: Context<AppCtx>, userId: string, name: string, exclude: { credential_id: string }[] = []) {
  const { rpID } = rp(c);
  return generateRegistrationOptions({
    rpName: APP_NAME,
    rpID,
    userName: name,
    userDisplayName: name,
    userID: enc.encode(userId) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: exclude.map((p) => ({ id: p.credential_id })),
  });
}

async function verifyRegistration(c: Context<AppCtx>, response: unknown, expectedChallenge: string) {
  const { rpID, origin } = rp(c);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
  } catch {
    throw new HttpError(400, 'passkey_failed', 'Passkey verification failed');
  }
  if (!v.verified || !v.registrationInfo) throw new HttpError(400, 'passkey_failed', 'Passkey verification failed');
  return v.registrationInfo.credential;
}

export const authRoutes = new Hono<AppCtx>();

// ---------------- registration (setup / invite / recovery) ----------------
authRoutes.post('/auth/register/options', async (c) => {
  const b = await body(c, regOptionsSchema);
  const g = globalDb(c.env.DB);
  const t = await resolveToken(c, b.token);
  let userId: string;
  let name: string;
  let exclude: { credential_id: string }[] = [];
  if (t.kind === 'recovery') {
    const u = await g.getUser(t.invite.target_user_id!);
    if (!u) throw new HttpError(410, 'invite_invalid', 'Link is invalid');
    userId = u.id;
    name = u.display_name;
    exclude = await g.passkeysOfUser(u.id);
  } else {
    if (!b.displayName) throw badRequest('validation', [{ path: 'displayName', code: 'required' }]);
    userId = newId();
    name = b.displayName;
  }
  const options = await registrationOptions(c, userId, name, exclude);
  const challengeId = await g.createChallenge({ challenge: options.challenge, purpose: 'register', inviteId: t.invite?.id ?? null, userId, displayName: name });
  return c.json({ challengeId, options });
});

authRoutes.post('/auth/register/verify', async (c) => {
  const b = await body(c, regVerifySchema);
  const g = globalDb(c.env.DB);
  const ch = await g.takeChallenge(b.challengeId, 'register');
  if (!ch || !ch.user_id || !ch.display_name) throw new HttpError(400, 'challenge_expired', 'Challenge expired');
  const t = await resolveToken(c, b.token);
  if ((t.invite?.id ?? null) !== ch.invite_id) throw new HttpError(400, 'challenge_mismatch', 'Challenge does not match link');
  const cred = await verifyRegistration(c, b.response, ch.challenge);
  const userLocale = b.locale ?? 'en';
  const passkey = g.insertPasskeyStmt({ userId: ch.user_id, credentialId: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports, label: b.deviceLabel ?? null });
  const stmts: D1PreparedStatement[] = [];
  let householdId: string | null;

  if (t.kind === 'bootstrap') {
    if (await g.hasSuperAdmin()) throw new HttpError(410, 'invite_invalid', 'Already set up');
    householdId = newId();
    stmts.push(
      g.createUserStmt({ id: ch.user_id, displayName: ch.display_name, isSuperAdmin: true, locale: b.locale ?? null }),
      g.createHouseholdStmt({ id: householdId, name: b.householdName ?? ch.display_name, createdBy: ch.user_id, locale: userLocale }),
      g.addMembershipStmt(householdId, ch.user_id, 'owner'),
      passkey,
      ...householdInitStatements(c.env.DB, householdId, userLocale),
    );
  } else {
    const inv = t.invite;
    // Claim the link first: single use even under concurrency.
    const claimed = await g.useInviteStmt(inv.id, ch.user_id).run();
    if (!claimed.meta.changes) throw new HttpError(410, 'invite_invalid', 'Link already used');
    if (t.kind === 'recovery') {
      // Recovery means the old device is gone (lost or stolen): its passkeys and every open session go.
      stmts.push(g.raw.prepare('DELETE FROM passkeys WHERE user_id = ?1').bind(ch.user_id), g.raw.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(ch.user_id), passkey);
      householdId = (await g.membershipsOfUser(ch.user_id))[0]?.id ?? null;
    } else {
      householdId = inv.household_id;
      stmts.push(g.createUserStmt({ id: ch.user_id, displayName: ch.display_name, locale: b.locale ?? null }), passkey, g.addMembershipStmt(inv.household_id!, ch.user_id, t.kind === 'owner' ? 'owner' : (inv.role ?? 'member')));
    }
  }
  const s = await newSession(c, ch.user_id, householdId);
  stmts.push(s.stmt, g.touchLogin(ch.user_id));
  if (householdId) stmts.push(tenantDb(c.env.DB, householdId).audit(ch.user_id, `auth.${t.kind}`, 'user', ch.user_id));
  try {
    await c.env.DB.batch(stmts); // one transaction: all or nothing
  } catch {
    // Give the link back so the person can retry (the batch rolled back entirely).
    if (t.invite) await g.unclaimInvite(t.invite.id, ch.user_id);
    // A concurrent bootstrap loses on the one-super-admin index: same answer as a used link.
    if (t.kind === 'bootstrap') throw new HttpError(410, 'invite_invalid', 'Already set up');
    throw new HttpError(409, 'registration_failed', 'Could not create the account; try again');
  }
  s.set();
  return c.json({ ok: true, kind: t.kind });
});

// ---------------- login ----------------
authRoutes.post('/auth/login/options', async (c) => {
  const { rpID } = rp(c);
  const options = await generateAuthenticationOptions({ rpID, allowCredentials: [], userVerification: 'preferred' });
  const challengeId = await globalDb(c.env.DB).createChallenge({ challenge: options.challenge, purpose: 'login' });
  return c.json({ challengeId, options });
});

authRoutes.post('/auth/login/verify', async (c) => {
  const b = await body(c, loginVerifySchema);
  const g = globalDb(c.env.DB);
  const ch = await g.takeChallenge(b.challengeId, 'login');
  if (!ch) throw new HttpError(400, 'challenge_expired', 'Challenge expired');
  const resp = b.response as unknown as AuthenticationResponseJSON;
  const pk = typeof resp.id === 'string' ? await g.passkeyByCredential(resp.id) : null;
  if (!pk) throw new HttpError(400, 'unknown_passkey', 'Unknown passkey');
  const { rpID, origin } = rp(c);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: resp,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: pk.credential_id, publicKey: new Uint8Array(pk.public_key), counter: pk.counter, transports: pk.transports ? JSON.parse(pk.transports) : undefined },
      requireUserVerification: false,
    });
  } catch {
    throw new HttpError(400, 'passkey_failed', 'Passkey verification failed');
  }
  if (!v.verified) throw new HttpError(400, 'passkey_failed', 'Passkey verification failed');
  const nc = v.authenticationInfo.newCounter;
  if (pk.counter !== 0 && nc <= pk.counter) throw new HttpError(400, 'passkey_failed', 'Counter regressed');
  const hh = (await g.membershipsOfUser(pk.user_id))[0]?.id ?? null;
  const s = await newSession(c, pk.user_id, hh);
  await c.env.DB.batch([s.stmt, g.bumpPasskey(pk.id, nc), g.touchLogin(pk.user_id)]);
  s.set();
  return c.json({ ok: true });
});

authRoutes.post('/auth/logout', async (c) => {
  const s = c.get('session');
  if (s) await globalDb(c.env.DB).deleteSession(s.tokenHash);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/auth/logout-all', requireSession, async (c) => {
  await globalDb(c.env.DB).deleteUserSessions(c.get('userId')!);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// ---------------- passkeys (signed in) ----------------
authRoutes.get('/auth/passkeys', requireSession, async (c) => {
  const rows = await globalDb(c.env.DB).passkeysOfUser(c.get('userId')!);
  return c.json({ passkeys: rows.map((r) => ({ id: r.id, label: r.device_label, createdAt: r.created_at, lastUsedAt: r.last_used_at })) });
});
authRoutes.post('/auth/passkeys/options', requireSession, async (c) => {
  const g = globalDb(c.env.DB);
  const u = (await g.getUser(c.get('userId')!))!;
  const options = await registrationOptions(c, u.id, u.display_name, await g.passkeysOfUser(u.id));
  const challengeId = await g.createChallenge({ challenge: options.challenge, purpose: 'register', userId: u.id, displayName: u.display_name });
  return c.json({ challengeId, options });
});
authRoutes.post('/auth/passkeys', requireSession, async (c) => {
  const b = await body(c, z.object({ challengeId: z.string().min(1).max(40), response: z.record(z.string(), z.unknown()), deviceLabel: z.string().trim().max(60).optional() }).strict());
  const g = globalDb(c.env.DB);
  const ch = await g.takeChallenge(b.challengeId, 'register');
  if (!ch || ch.user_id !== c.get('userId') || ch.invite_id) throw new HttpError(400, 'challenge_expired', 'Challenge expired');
  const cred = await verifyRegistration(c, b.response, ch.challenge);
  await g.insertPasskeyStmt({ userId: ch.user_id, credentialId: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports, label: b.deviceLabel ?? null }).run();
  return c.json({ ok: true });
});
authRoutes.delete('/auth/passkeys/:id', requireSession, async (c) => {
  const g = globalDb(c.env.DB);
  const uid = c.get('userId')!;
  if ((await g.countPasskeys(uid)) <= 1) throw new HttpError(409, 'last_passkey', 'Cannot remove the last passkey');
  const r = await g.deletePasskey(uid, c.req.param('id'));
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});

/** The user's active sessions (no token material; the id is a short hash prefix). */
authRoutes.get('/auth/sessions', requireSession, async (c) => {
  const s = c.get('session')!;
  const rows = await globalDb(c.env.DB).sessionsOfUser(s.userId);
  return c.json({ sessions: rows.map((r) => ({ id: r.token_hash.slice(0, 12), current: r.token_hash === s.tokenHash, createdAt: r.created_at, lastSeenAt: r.last_seen_at, device: (r.user_agent ?? '').slice(0, 120) })) });
});

// ---------------- me / session ----------------
authRoutes.get('/me', requireSession, async (c) => {
  const g = globalDb(c.env.DB);
  const s = c.get('session')!;
  const [user, households] = await Promise.all([g.getUser(s.userId), g.membershipsOfUser(s.userId)]);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');
  let active: MeResponse['active'] = null;
  let role: MeResponse['role'] = null;
  let badges: MeResponse['badges'] = { uncategorized: 0, overBudget: false };
  const m = households.find((h) => h.id === s.activeHouseholdId);
  if (m) {
    const h = await g.getHousehold(m.id);
    if (h) {
      const today = todayInTz(h.timezone);
      active = { id: h.id, name: h.name, currency: h.currency, timezone: h.timezone, hasSampleData: h.has_sample_data === 1, aiEnabled: h.ai_enabled === 1, today };
      role = m.role;
      if (h.status === 'active') badges = await loadBadges(tenantDb(c.env.DB, h.id), h, today);
    }
  }
  const res: MeResponse = {
    user: { id: user.id, displayName: user.display_name, isSuperAdmin: user.is_super_admin === 1, locale: (user.locale as 'en' | 'he' | null) ?? null, theme: (user.theme as MeResponse['user']['theme']) ?? null },
    households: households.map((h) => ({ id: h.id, name: h.name, role: h.role })),
    active,
    role,
    features: { ai: getProvider(c.env) !== null },
    badges,
  };
  return c.json(res);
});

authRoutes.patch('/me', requireSession, async (c) => {
  const b = await body(c, patchMeSchema);
  await globalDb(c.env.DB).updateUser(c.get('userId')!, b);
  return c.json({ ok: true });
});

authRoutes.post('/session/household', requireSession, async (c) => {
  const b = await body(c, z.object({ id: z.string().min(1).max(40) }).strict());
  const g = globalDb(c.env.DB);
  const s = c.get('session')!;
  if (!(await g.membership(b.id, s.userId))) throw notFound();
  await c.env.DB.batch([g.raw.prepare('UPDATE sessions SET active_household_id = ?2 WHERE token_hash = ?1').bind(s.tokenHash, b.id), g.touchMembership(b.id, s.userId)]);
  return c.json({ ok: true });
});

// ---------------- invites ----------------
authRoutes.post('/invites/inspect', async (c) => {
  const b = await body(c, tokenSchema);
  const t = await resolveToken(c, b.token);
  if (t.kind === 'bootstrap') return c.json({ kind: 'bootstrap' });
  const h = t.invite.household_id ? await globalDb(c.env.DB).getHousehold(t.invite.household_id) : null;
  return c.json({ kind: t.kind, householdName: h?.name ?? null, role: t.kind === 'owner' ? 'owner' : t.invite.role });
});

authRoutes.post('/invites/accept', requireSession, async (c) => {
  const b = await body(c, tokenSchema);
  const t = await resolveToken(c, b.token);
  if (t.kind !== 'owner' && t.kind !== 'member') throw new HttpError(400, 'invite_wrong_kind', 'This link cannot be accepted');
  const g = globalDb(c.env.DB);
  const s = c.get('session')!;
  const claimed = await g.useInviteStmt(t.invite.id, s.userId).run();
  if (!claimed.meta.changes) throw new HttpError(410, 'invite_invalid', 'Link already used');
  const hid = t.invite.household_id!;
  try {
    await c.env.DB.batch([
    g.upsertMembershipStmt(hid, s.userId, t.kind === 'owner' ? 'owner' : (t.invite.role ?? 'member')),
    g.raw.prepare('UPDATE sessions SET active_household_id = ?2 WHERE token_hash = ?1').bind(s.tokenHash, hid),
    tenantDb(c.env.DB, hid).audit(s.userId, 'invite.accept', 'user', s.userId),
    ]);
  } catch (e) {
    await g.unclaimInvite(t.invite.id, s.userId);
    throw e;
  }
  return c.json({ ok: true });
});

export const INVITE_TTL_MS = 7 * DAY_MS;
export const RECOVERY_TTL_MS = 2 * DAY_MS;
