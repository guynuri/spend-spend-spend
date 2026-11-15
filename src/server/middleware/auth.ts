import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppCtx } from '../types';
import { HttpError } from '../http';
import { globalDb } from '../db/global';
import { tenantDb } from '../db/tenant';
import { randomToken, sha256Hex } from '../lib/crypto';

export const SESSION_COOKIE = '__Host-mz_session';
const HOUR = 3_600_000;

/** CSRF: non-GET needs same Origin, X-MZ: 1 and a JSON content type (PLAN §7). */
export const csrf: MiddlewareHandler<AppCtx> = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('origin');
    const reqOrigin = new URL(c.req.url).origin;
    const ct = (c.req.header('content-type') ?? '').toLowerCase();
    if (origin !== reqOrigin || c.req.header('x-mz') !== '1' || !ct.startsWith('application/json')) throw new HttpError(403, 'csrf', 'CSRF check failed');
  }
  await next();
};

/** Loads the session if a valid cookie is present; never fails by itself. */
export const loadSession: MiddlewareHandler<AppCtx> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && token.length < 100) {
    const g = globalDb(c.env.DB);
    const hash = await sha256Hex(token);
    const s = await g.getSession(hash);
    const now = new Date().toISOString();
    if (s && s.expires_at > now && s.absolute_expires_at > now) {
      c.set('session', { tokenHash: hash, userId: s.user_id, activeHouseholdId: s.active_household_id, isSuperAdmin: s.is_super_admin === 1 });
      c.set('userId', s.user_id);
      // Rolling expiry, written at most once an hour (saves D1 writes).
      if (Date.now() - Date.parse(s.last_seen_at) > HOUR) await g.refreshSession(hash);
    } else if (s) {
      await g.deleteSession(hash);
    }
  }
  await next();
};

export const requireSession: MiddlewareHandler<AppCtx> = async (c, next) => {
  if (!c.get('session')) throw new HttpError(401, 'unauthorized', 'Sign in required');
  await next();
};

export const requireSuperAdmin: MiddlewareHandler<AppCtx> = async (c, next) => {
  const s = c.get('session');
  if (!s) throw new HttpError(401, 'unauthorized', 'Sign in required');
  if (!s.isSuperAdmin) throw new HttpError(403, 'forbidden', 'Super-admin only');
  await next();
};

/**
 * Resolves the household ONLY from the session, verified against memberships on every request
 * (PLAN §6.1). Exposes the tenant-scoped query helper as c.var.db.
 */
export const household: MiddlewareHandler<AppCtx> = async (c, next) => {
  const s = c.get('session');
  if (!s) throw new HttpError(401, 'unauthorized', 'Sign in required');
  if (!s.activeHouseholdId) throw new HttpError(403, 'no_household', 'No active household');
  const g = globalDb(c.env.DB);
  const [m, h] = await g.raw.batch<Record<string, unknown>>([
    g.raw.prepare('SELECT role FROM memberships WHERE household_id = ?1 AND user_id = ?2').bind(s.activeHouseholdId, s.userId),
    g.raw.prepare('SELECT * FROM households WHERE id = ?1').bind(s.activeHouseholdId),
  ]);
  const role = m?.results[0]?.role as AppCtx['Variables']['role'];
  const hh = h?.results[0] as AppCtx['Variables']['household'];
  if (!role || !hh) {
    await g.setActiveHousehold(s.tokenHash, null);
    throw new HttpError(403, 'no_household', 'Not a member');
  }
  if (hh.status !== 'active') throw new HttpError(403, 'household_disabled', 'Household disabled');
  c.set('householdId', hh.id);
  c.set('household', hh);
  c.set('role', role);
  c.set('db', tenantDb(c.env.DB, hh.id));
  await next();
};

const RANK = { viewer: 1, member: 2, owner: 3 } as const;
/** GET needs viewer; other methods need member (PLAN §6.5). */
export const roleDefault: MiddlewareHandler<AppCtx> = async (c, next) => {
  const role = c.get('role');
  const need = c.req.method === 'GET' ? 'viewer' : 'member';
  if (!role || RANK[role] < RANK[need]) throw new HttpError(403, 'forbidden_role', 'Insufficient role');
  await next();
};
export const requireOwner: MiddlewareHandler<AppCtx> = async (c, next) => {
  if (c.get('role') !== 'owner') throw new HttpError(403, 'forbidden_role', 'Owner only');
  await next();
};

/** Fixed-window rate limit in D1 keyed by client IP + group. */
export function rateLimit(group: string, max: number, windowMs: number): MiddlewareHandler<AppCtx> {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'local';
    const n = await globalDb(c.env.DB).hit(`${group}:${ip}`, windowMs);
    if (n > max) throw new HttpError(429, 'rate_limited', 'Too many requests');
    await next();
  };
}

export const TOKEN_FAIL_WINDOW = 15 * 60_000;
export const TOKEN_FAIL_MAX = 5;
export async function assertTokenAttemptsLeft(c: Context<AppCtx>) {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  if ((await globalDb(c.env.DB).peek(`tokenfail:${ip}`, TOKEN_FAIL_WINDOW)) >= TOKEN_FAIL_MAX) throw new HttpError(429, 'rate_limited', 'Too many failed attempts');
}
export async function recordTokenFailure(c: Context<AppCtx>) {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  await globalDb(c.env.DB).hit(`tokenfail:${ip}`, TOKEN_FAIL_WINDOW);
}

/** Creates a session row + cookie. Returns statements to include in a batch. */
export async function newSession(c: Context<AppCtx>, userId: string, householdId: string | null) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const stmt = globalDb(c.env.DB).createSessionStmt(hash, userId, householdId, c.req.header('user-agent') ?? null);
  const set = () =>
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 180 * 86400 });
  return { stmt, set };
}

export function clearSessionCookie(c: Context<AppCtx>) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}
