import { globalDb } from './global';

/** Daily cron (PLAN §4.4): expired sessions/challenges, old invites, rate-limit rows, ai_usage > 90 days. */
export async function runCleanup(db: D1Database, now = new Date()) {
  const iso = now.toISOString();
  const day90 = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  await db.batch([...globalDb(db).cleanup(iso), db.prepare('DELETE FROM ai_usage WHERE day < ?1').bind(day90)]);
}
