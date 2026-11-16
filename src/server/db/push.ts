/** Web Push subscriptions of ONE user (global table, per device). Reached from routes via tenantDb.pushOf(userId). */
import { newId, nowIso } from '../lib/crypto';
import type { PushTarget } from '../lib/webpush';

export interface PushSubRow extends PushTarget {
  id: string;
  user_id: string;
  label: string | null;
  created_at: string;
}

export function pushSubs(db: D1Database, userId: string) {
  return {
    list: async () => (await db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?1 ORDER BY created_at').bind(userId).all<PushSubRow>()).results,
    count: async () => (await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?1').bind(userId).first<{ n: number }>())?.n ?? 0,
    /** Upsert by endpoint: a browser re-subscribing (or another user signing in on it) takes the row over. */
    save: async (s: { endpoint: string; p256dh: string; auth: string; label: string | null }) => {
      const id = newId();
      await db
        .prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`,
        )
        .bind(id, userId, s.endpoint, s.p256dh, s.auth, s.label, nowIso())
        .run();
    },
    exists: async (endpoint: string) => !!(await db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2').bind(endpoint, userId).first()),
    remove: async (id: string) => (await db.prepare('DELETE FROM push_subscriptions WHERE id = ?1 AND user_id = ?2').bind(id, userId).run()).meta.changes,
  };
}

/** Drops subscriptions the push service reported gone (404/410). */
export const deleteGoneStmt = (db: D1Database, ids: string[]) => db.prepare('DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids));
