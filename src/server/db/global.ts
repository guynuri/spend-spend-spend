/**
 * Global (non-tenant) data access. Imported only by auth/admin routes, middleware, seed and
 * db/** (PLAN §6.3). Admin functions return metadata only — never amounts or descriptions.
 */
import type { Role } from '../../shared/schemas/me';
import { DAY_MS, isoIn, newId, nowIso } from '../lib/crypto';
import type { HouseholdRow } from './rows';
export type { HouseholdRow } from './rows';

export interface UserRow {
  id: string;
  display_name: string;
  is_super_admin: number;
  locale: string | null;
  theme: string | null;
}
export interface InviteRow {
  id: string;
  kind: 'bootstrap' | 'owner' | 'member' | 'recovery';
  household_id: string | null;
  role: Role | null;
  target_user_id: string | null;
  email: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}
export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string | null;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export const SESSION_ROLLING_MS = 60 * DAY_MS;
export const SESSION_ABSOLUTE_MS = 180 * DAY_MS;

export function globalDb(db: D1Database) {
  return {
    raw: db,
    // ---------- users ----------
    hasSuperAdmin: async () => !!(await db.prepare('SELECT 1 FROM users WHERE is_super_admin = 1 LIMIT 1').first()),
    getUser: (id: string) => db.prepare('SELECT id, display_name, is_super_admin, locale, theme FROM users WHERE id = ?1').bind(id).first<UserRow>(),
    createUserStmt: (u: { id: string; displayName: string; isSuperAdmin?: boolean; locale?: string | null }) =>
      db.prepare('INSERT INTO users (id, display_name, is_super_admin, locale, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(u.id, u.displayName, u.isSuperAdmin ? 1 : 0, u.locale ?? null, nowIso()),
    updateUser: (id: string, p: { locale?: string; theme?: string; displayName?: string }) =>
      db
        .prepare('UPDATE users SET locale = COALESCE(?2, locale), theme = COALESCE(?3, theme), display_name = COALESCE(?4, display_name) WHERE id = ?1')
        .bind(id, p.locale ?? null, p.theme ?? null, p.displayName ?? null)
        .run(),
    touchLogin: (id: string) => db.prepare('UPDATE users SET last_login_at = ?2 WHERE id = ?1').bind(id, nowIso()),

    // ---------- passkeys ----------
    passkeyByCredential: (credentialId: string) => db.prepare('SELECT * FROM passkeys WHERE credential_id = ?1').bind(credentialId).first<PasskeyRow>(),
    passkeysOfUser: async (userId: string) =>
      (await db.prepare('SELECT id, credential_id, device_label, created_at, last_used_at, transports FROM passkeys WHERE user_id = ?1 ORDER BY created_at').bind(userId).all<Omit<PasskeyRow, 'public_key' | 'counter' | 'user_id'>>()).results,
    insertPasskeyStmt: (p: { userId: string; credentialId: string; publicKey: Uint8Array; counter: number; transports: string[] | undefined; label: string | null }) =>
      db
        .prepare('INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_label, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(newId(), p.userId, p.credentialId, p.publicKey, p.counter, p.transports ? JSON.stringify(p.transports) : null, p.label, nowIso()),
    bumpPasskey: (id: string, counter: number) => db.prepare('UPDATE passkeys SET counter = ?2, last_used_at = ?3 WHERE id = ?1').bind(id, counter, nowIso()),
    countPasskeys: async (userId: string) => (await db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?1').bind(userId).first<{ n: number }>())?.n ?? 0,
    deletePasskey: (userId: string, id: string) => db.prepare('DELETE FROM passkeys WHERE id = ?1 AND user_id = ?2').bind(id, userId).run(),

    // ---------- challenges ----------
    createChallenge: async (c: { challenge: string; purpose: 'register' | 'login'; inviteId?: string | null; userId?: string | null; displayName?: string | null }) => {
      const id = newId();
      await db
        .prepare('INSERT INTO auth_challenges (id, challenge, purpose, invite_id, user_id, display_name, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(id, c.challenge, c.purpose, c.inviteId ?? null, c.userId ?? null, c.displayName ?? null, isoIn(5 * 60_000))
        .run();
      return id;
    },
    /** Single use: deleted as it is read; expired → null. */
    takeChallenge: async (id: string, purpose: 'register' | 'login') => {
      const row = await db
        .prepare('DELETE FROM auth_challenges WHERE id = ?1 AND purpose = ?2 RETURNING challenge, invite_id, user_id, display_name, expires_at')
        .bind(id, purpose)
        .first<{ challenge: string; invite_id: string | null; user_id: string | null; display_name: string | null; expires_at: string }>();
      if (!row || row.expires_at < nowIso()) return null;
      return row;
    },

    // ---------- sessions ----------
    createSessionStmt: (tokenHash: string, userId: string, householdId: string | null, userAgent: string | null) => {
      const now = nowIso();
      return db
        .prepare('INSERT INTO sessions (token_hash, user_id, active_household_id, created_at, last_seen_at, expires_at, absolute_expires_at, user_agent) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)')
        .bind(tokenHash, userId, householdId, now, isoIn(SESSION_ROLLING_MS), isoIn(SESSION_ABSOLUTE_MS), userAgent ? userAgent.slice(0, 200) : null);
    },
    getSession: (tokenHash: string) =>
      db
        .prepare(
          `SELECT s.token_hash, s.user_id, s.active_household_id, s.last_seen_at, s.expires_at, s.absolute_expires_at, u.is_super_admin
             FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1`,
        )
        .bind(tokenHash)
        .first<{ token_hash: string; user_id: string; active_household_id: string | null; last_seen_at: string; expires_at: string; absolute_expires_at: string; is_super_admin: number }>(),
    refreshSession: (tokenHash: string) =>
      db.prepare('UPDATE sessions SET last_seen_at = ?2, expires_at = MIN(?3, absolute_expires_at) WHERE token_hash = ?1').bind(tokenHash, nowIso(), isoIn(SESSION_ROLLING_MS)).run(),
    deleteSession: (tokenHash: string) => db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run(),
    sessionsOfUser: async (userId: string) =>
      (await db.prepare('SELECT token_hash, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ?1 AND expires_at > ?2 ORDER BY last_seen_at DESC').bind(userId, nowIso()).all<{ token_hash: string; created_at: string; last_seen_at: string; user_agent: string | null }>()).results,
    deleteUserSessions: (userId: string) => db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId).run(),
    setActiveHousehold: (tokenHash: string, householdId: string | null) => db.prepare('UPDATE sessions SET active_household_id = ?2 WHERE token_hash = ?1').bind(tokenHash, householdId).run(),
    /** Clears the active household of every session of a user in a household (membership removed). */
    clearActiveForMember: (userId: string, householdId: string) =>
      db.prepare('UPDATE sessions SET active_household_id = NULL WHERE user_id = ?1 AND active_household_id = ?2').bind(userId, householdId),

    // ---------- households & memberships ----------
    getHousehold: (id: string) => db.prepare('SELECT * FROM households WHERE id = ?1').bind(id).first<HouseholdRow>(),
    createHouseholdStmt: (h: { id: string; name: string; createdBy: string | null; locale: string }) =>
      db.prepare('INSERT INTO households (id, name, locale, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5)').bind(h.id, h.name, h.locale, nowIso(), h.createdBy),
    membershipsOfUser: async (userId: string) =>
      (
        await db
          .prepare(
            `SELECT h.id, h.name, m.role, h.status FROM memberships m JOIN households h ON h.id = m.household_id
              WHERE m.user_id = ?1 ORDER BY COALESCE(m.last_used_at, m.created_at) DESC`,
          )
          .bind(userId)
          .all<{ id: string; name: string; role: Role; status: string }>()
      ).results,
    membership: (householdId: string, userId: string) =>
      db.prepare('SELECT role FROM memberships WHERE household_id = ?1 AND user_id = ?2').bind(householdId, userId).first<{ role: Role }>(),
    addMembershipStmt: (householdId: string, userId: string, role: Role) =>
      db.prepare('INSERT INTO memberships (household_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(household_id, user_id) DO NOTHING').bind(householdId, userId, role, nowIso()),
    /** Adds a membership, or raises the role of an existing one (never lowers it). */
    upsertMembershipStmt: (householdId: string, userId: string, role: Role) =>
      db
        .prepare(
          `INSERT INTO memberships (household_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(household_id, user_id) DO UPDATE SET role = excluded.role
            WHERE (CASE excluded.role WHEN 'owner' THEN 3 WHEN 'member' THEN 2 ELSE 1 END) > (CASE memberships.role WHEN 'owner' THEN 3 WHEN 'member' THEN 2 ELSE 1 END)`,
        )
        .bind(householdId, userId, role, nowIso()),
    touchMembership: (householdId: string, userId: string) => db.prepare('UPDATE memberships SET last_used_at = ?3 WHERE household_id = ?1 AND user_id = ?2').bind(householdId, userId, nowIso()),
    members: async (householdId: string) =>
      (
        await db
          .prepare(
            `SELECT u.id, u.display_name, m.role, m.created_at,
                    (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys
               FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.household_id = ?1 ORDER BY m.created_at`,
          )
          .bind(householdId)
          .all<{ id: string; display_name: string; role: Role; created_at: string; passkeys: number }>()
      ).results,
    countOwners: async (householdId: string) => (await db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE household_id = ?1 AND role = 'owner'").bind(householdId).first<{ n: number }>())?.n ?? 0,
    setRole: (householdId: string, userId: string, role: Role) => db.prepare('UPDATE memberships SET role = ?3 WHERE household_id = ?1 AND user_id = ?2').bind(householdId, userId, role),
    removeMember: (householdId: string, userId: string) => db.prepare('DELETE FROM memberships WHERE household_id = ?1 AND user_id = ?2').bind(householdId, userId),
    updateHousehold: (id: string, p: { name?: string; currency?: string; timezone?: string; safetyBufferMinor?: number; forecastDailyVariableMinor?: number | null; clearDailyVariable?: boolean }) =>
      db
        .prepare(
          `UPDATE households SET name = COALESCE(?2, name), currency = COALESCE(?3, currency), timezone = COALESCE(?4, timezone),
             safety_buffer_minor = COALESCE(?5, safety_buffer_minor),
             forecast_daily_variable_minor = CASE WHEN ?7 = 1 THEN NULL ELSE COALESCE(?6, forecast_daily_variable_minor) END
           WHERE id = ?1`,
        )
        .bind(id, p.name ?? null, p.currency ?? null, p.timezone ?? null, p.safetyBufferMinor ?? null, p.forecastDailyVariableMinor ?? null, p.clearDailyVariable ? 1 : 0)
        .run(),
    setHouseholdStatus: (id: string, status: 'active' | 'disabled') => db.prepare('UPDATE households SET status = ?2 WHERE id = ?1').bind(id, status).run(),
    setSampleData: (id: string, v: boolean) => db.prepare('UPDATE households SET has_sample_data = ?2 WHERE id = ?1').bind(id, v ? 1 : 0),
    setAi: (id: string, enabled: boolean, userId: string, provider: string) =>
      db
        .prepare('UPDATE households SET ai_enabled = ?2, ai_consent_at = CASE WHEN ?2 = 1 THEN ?3 ELSE ai_consent_at END, ai_consent_by = CASE WHEN ?2 = 1 THEN ?4 ELSE ai_consent_by END, ai_consent_provider = CASE WHEN ?2 = 1 THEN ?5 ELSE ai_consent_provider END WHERE id = ?1')
        .bind(id, enabled ? 1 : 0, nowIso(), userId, provider)
        .run(),
    deleteHouseholdStmt: (id: string) => db.prepare('DELETE FROM households WHERE id = ?1').bind(id),

    // ---------- invites ----------
    createInvite: async (i: { tokenHash: string; kind: InviteRow['kind']; householdId: string | null; role: Role | null; targetUserId?: string | null; email?: string | null; note?: string | null; createdBy: string | null; ttlMs: number }) => {
      const id = newId();
      await db
        .prepare('INSERT INTO invites (id, token_hash, kind, household_id, role, target_user_id, email, note, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)')
        .bind(id, i.tokenHash, i.kind, i.householdId, i.role, i.targetUserId ?? null, i.email ?? null, i.note ?? null, i.createdBy, nowIso(), isoIn(i.ttlMs))
        .run();
      return id;
    },
    inviteByHash: (tokenHash: string) => db.prepare('SELECT * FROM invites WHERE token_hash = ?1').bind(tokenHash).first<InviteRow>(),
    inviteById: (id: string) => db.prepare('SELECT * FROM invites WHERE id = ?1').bind(id).first<InviteRow>(),
    /** Marks used only if still unused — the WHERE makes concurrent use impossible. */
    useInviteStmt: (id: string, userId: string) => db.prepare('UPDATE invites SET used_at = ?2, used_by = ?3 WHERE id = ?1 AND used_at IS NULL AND revoked_at IS NULL').bind(id, nowIso(), userId),
    unclaimInvite: (id: string, userId: string) => db.prepare('UPDATE invites SET used_at = NULL, used_by = NULL WHERE id = ?1 AND used_by = ?2').bind(id, userId).run(),
    pendingInvites: async (householdId: string) =>
      (
        await db
          .prepare("SELECT id, kind, role, email, note, created_at, expires_at, target_user_id FROM invites WHERE household_id = ?1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?2 AND kind IN ('owner','member','recovery') ORDER BY created_at DESC")
          .bind(householdId, nowIso())
          .all<Pick<InviteRow, 'id' | 'kind' | 'role' | 'email' | 'note' | 'created_at' | 'expires_at' | 'target_user_id'>>()
      ).results,
    revokeInvite: (householdId: string, id: string) => db.prepare('UPDATE invites SET revoked_at = ?3 WHERE id = ?1 AND household_id = ?2 AND used_at IS NULL').bind(id, householdId, nowIso()).run(),

    // ---------- rate limits ----------
    /** Increments and returns the count for key in the current fixed window. */
    hit: async (key: string, windowMs: number) => {
      const ws = Math.floor(Date.now() / windowMs) * windowMs;
      const r = await db
        .prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count')
        .bind(key, ws)
        .first<{ count: number }>();
      return r?.count ?? 1;
    },
    peek: async (key: string, windowMs: number) => {
      const ws = Math.floor(Date.now() / windowMs) * windowMs;
      return (await db.prepare('SELECT count FROM rate_limits WHERE key = ?1 AND window_start = ?2').bind(key, ws).first<{ count: number }>())?.count ?? 0;
    },

    // ---------- admin (metadata only) ----------
    adminHouseholds: async () =>
      (
        await db
          .prepare(
            `SELECT h.id, h.name, h.status, h.created_at,
                    (SELECT COUNT(*) FROM memberships m WHERE m.household_id = h.id) AS member_count,
                    (SELECT MAX(i.created_at) FROM imports i WHERE i.household_id = h.id AND i.status = 'committed') AS last_import_at,
                    (SELECT json_group_array(json_object('id', u.id, 'name', u.display_name)) FROM memberships m JOIN users u ON u.id = m.user_id
                      WHERE m.household_id = h.id AND m.role = 'owner') AS owners_json
               FROM households h ORDER BY h.created_at DESC`,
          )
          .all<{ id: string; name: string; status: string; created_at: string; member_count: number; last_import_at: string | null; owners_json: string }>()
      ).results,

    // ---------- maintenance (cron) ----------
    cleanup: (now: string) => [
      db.prepare('DELETE FROM sessions WHERE expires_at < ?1 OR absolute_expires_at < ?1').bind(now),
      db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?1').bind(now),
      db.prepare('DELETE FROM invites WHERE expires_at < ?1').bind(new Date(Date.parse(now) - 30 * DAY_MS).toISOString()),
      db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(Date.now() - DAY_MS),
    ],
  };
}

export type GlobalDb = ReturnType<typeof globalDb>;
