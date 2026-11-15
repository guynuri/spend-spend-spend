import { env, exports } from 'cloudflare:workers';
import { householdInitStatements } from '../../src/server/db/householdInit';
import { randomToken, sha256Hex, newId, isoIn, DAY_MS } from '../../src/server/lib/crypto';

export const BASE = 'http://example.com';
export const DB = (env as unknown as { DB: D1Database }).DB;

export interface CallOpts {
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
  csrf?: boolean;
}

export async function call(method: string, path: string, o: CallOpts = {}) {
  const h: Record<string, string> = { ...o.headers };
  if (o.cookie) h.cookie = o.cookie;
  if (method !== 'GET' && o.csrf !== false) {
    h.origin ??= BASE;
    h['x-mz'] ??= '1';
    h['content-type'] ??= 'application/json';
  }
  return exports.default.fetch(`${BASE}${path}`, { method, headers: h, body: method === 'GET' ? undefined : o.body === undefined ? '{}' : typeof o.body === 'string' ? o.body : JSON.stringify(o.body) });
}
export async function json<T = Record<string, unknown>>(method: string, path: string, o: CallOpts = {}): Promise<{ status: number; body: T; res: Response }> {
  const res = await call(method, path, o);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, res };
}

export async function makeUser(name = 'User', superAdmin = false) {
  // Only one super-admin can exist (migration 0005): reuse it.
  if (superAdmin) {
    const sa = await DB.prepare('SELECT id FROM users WHERE is_super_admin = 1').first<{ id: string }>();
    if (sa) return sa.id;
  }
  const id = newId();
  await DB.prepare('INSERT INTO users (id, display_name, is_super_admin, created_at) VALUES (?1, ?2, ?3, ?4)').bind(id, name, superAdmin ? 1 : 0, new Date().toISOString()).run();
  return id;
}

export async function makeHousehold(name: string, ownerId?: string, locale: 'en' | 'he' = 'en') {
  const id = newId();
  await DB.batch([
    DB.prepare("INSERT INTO households (id, name, locale, created_at) VALUES (?1, ?2, ?3, ?4)").bind(id, name, locale, new Date().toISOString()),
    ...householdInitStatements(DB, id, locale),
  ]);
  if (ownerId) await addMember(id, ownerId, 'owner');
  return id;
}

export async function addMember(householdId: string, userId: string, role: 'owner' | 'member' | 'viewer') {
  await DB.prepare('INSERT INTO memberships (household_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)').bind(householdId, userId, role, new Date().toISOString()).run();
}

/** Test-only: inserts a session row directly and returns the Cookie header value (PLAN §15.2). */
export async function sessionFor(userId: string, householdId: string | null, o: { expiresInMs?: number; absoluteInMs?: number; lastSeenAgoMs?: number } = {}) {
  const token = randomToken();
  const now = new Date();
  await DB.prepare('INSERT INTO sessions (token_hash, user_id, active_household_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(await sha256Hex(token), userId, householdId, now.toISOString(), new Date(now.getTime() - (o.lastSeenAgoMs ?? 0)).toISOString(), isoIn(o.expiresInMs ?? 60 * DAY_MS), isoIn(o.absoluteInMs ?? 180 * DAY_MS))
    .run();
  return `__Host-mz_session=${token}`;
}

export async function makeInvite(o: { kind: 'owner' | 'member' | 'recovery'; householdId?: string | null; role?: string | null; targetUserId?: string | null; expiresInMs?: number; used?: boolean; revoked?: boolean }) {
  const token = randomToken();
  const id = newId();
  await DB.prepare('INSERT INTO invites (id, token_hash, kind, household_id, role, target_user_id, created_at, expires_at, used_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
    .bind(id, await sha256Hex(token), o.kind, o.householdId ?? null, o.role ?? null, o.targetUserId ?? null, new Date().toISOString(), isoIn(o.expiresInMs ?? 7 * DAY_MS), o.used ? new Date().toISOString() : null, o.revoked ? new Date().toISOString() : null)
    .run();
  return { token, id };
}

/** A user with an owner session in a fresh household. */
export async function ownerSetup(name = 'Owner', hhName = 'Home') {
  const userId = await makeUser(name);
  const householdId = await makeHousehold(hhName, userId);
  const cookie = await sessionFor(userId, householdId);
  return { userId, householdId, cookie };
}

export const cookieFrom = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
export async function resetRateLimits() {
  await DB.prepare('DELETE FROM rate_limits').run();
}
