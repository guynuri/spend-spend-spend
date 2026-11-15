import type { TenantDb } from '../tenant';

export const AI_LIMITS = { categorize: 10, review: 5 } as const;
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Today's usage for this household and the global total across households (calls only). */
export async function usageToday(q: TenantDb, day = utcDay()) {
  const [mine, global] = await Promise.all([q.all<{ feature: string; calls: number }>('SELECT feature, calls FROM ai_usage WHERE household_id = ?1 AND day = ?2', day), q.aiCallsToday(day)]);
  const m = new Map(mine.map((r) => [r.feature, r.calls]));
  return { categorize: m.get('categorize') ?? 0, review: m.get('review') ?? 0, global };
}

/** Reserve one call (upsert). Checked against limits before the call is made. */
export function reserveStmt(q: TenantDb, feature: 'categorize' | 'review', day = utcDay()) {
  return q.stmt(
    `INSERT INTO ai_usage (household_id, day, feature, calls) VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(household_id, day, feature) DO UPDATE SET calls = calls + 1 WHERE ai_usage.household_id = ?1`,
    day,
    feature,
  );
}
export function recordTokensStmt(q: TenantDb, feature: string, tin: number, tout: number, day = utcDay()) {
  return q.stmt('UPDATE ai_usage SET tokens_in = tokens_in + ?4, tokens_out = tokens_out + ?5 WHERE household_id = ?1 AND day = ?2 AND feature = ?3', day, feature, tin, tout);
}
