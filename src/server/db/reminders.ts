/**
 * Reminder delivery: the 15-minute cron finds due reminders across households, claims them with a
 * conditional UPDATE (so overlapping runs never double-send) and pushes to the user's devices.
 * Bounded per run to stay inside the Workers Free CPU / subrequest limits; leftovers go next run.
 */
import type { AppEnv } from '../env';
import { isDue, type Schedule } from '../../shared/reminders';
import { bankById } from '../../shared/banks';
import { sendPush, vapidKeys, type PushMessage, type PushTarget, type VapidKeys } from '../lib/webpush';
import { tenantDb } from './tenant';
import type { HouseholdRow } from './rows';
import { deleteGoneStmt, type PushSubRow } from './push';
import { loadBase } from './sql/facts';
import { reviewDue } from './sql/review';

const SCAN = 200;
const MAX_PUSHES = 40; // Workers Free: 50 subrequests per invocation
const MAX_REVIEW_CHECKS = 3; // each one loads a household's facts
const REVIEW_CHECK_EVERY = 6 * 3_600_000;

type Kind = 'import' | 'daily' | 'review' | 'test';
const TEXT: Record<'en' | 'he', Record<Kind, [string, string]>> = {
  en: {
    import: ['Time to import new data', 'Download the latest statement from your bank and import it.'],
    daily: ["Add today's transactions", 'Anything you paid today? It takes a few seconds.'],
    review: ['Your monthly review is ready', 'A month ended. Take a few minutes to see how it went.'],
    test: ['Notifications are on', 'Reminders will arrive on this device.'],
  },
  he: {
    import: ['הגיע הזמן לייבא נתונים חדשים', 'הורידו את הדוח האחרון מהבנק וייבאו אותו.'],
    daily: ['הוסיפו את התנועות של היום', 'שילמתם היום על משהו? זה לוקח כמה שניות.'],
    review: ['הסיכום החודשי מוכן', 'החודש הסתיים. כמה דקות כדי לראות איך הוא עבר.'],
    test: ['ההתראות פועלות', 'תזכורות יגיעו למכשיר הזה.'],
  },
};

/** Where a reminder lands in the app. A catalog bank adds openBank=1 (the import page offers its website). */
export function reminderUrl(r: { kind: Kind; account_id?: string | null; bank_id?: string | null; month?: string | null }): string {
  if (r.kind === 'daily') return '/?add=1';
  if (r.kind === 'review') return r.month ? `/review?month=${r.month}&step=0` : '/review';
  if (r.kind === 'test') return '/settings';
  if (!r.account_id) return '/import';
  return `/import?account=${encodeURIComponent(r.account_id)}${bankById(r.bank_id) ? '&openBank=1' : ''}`;
}

export function pushMessage(kind: Kind, locale: string | null, url: string, tag: string): PushMessage {
  const [title, body] = TEXT[locale === 'he' ? 'he' : 'en'][kind];
  return { title, body, url, tag };
}

/** Sends to every target; returns the ids the push service reported gone (404/410). */
export async function sendAll(keys: VapidKeys, subs: (PushTarget & { id: string })[], msg: PushMessage, fetchImpl: typeof fetch = fetch) {
  const st = await Promise.all(subs.map((s) => sendPush(keys, s, msg, fetchImpl).catch(() => 0)));
  return { sent: st.filter((x) => x >= 200 && x < 300).length, gone: subs.filter((_, i) => st[i] === 404 || st[i] === 410).map((s) => s.id) };
}

interface DueRow extends Schedule {
  id: string;
  household_id: string;
  user_id: string;
  account_id: string | null;
  last_sent_at: string;
  review_month: string | null;
  tz: string;
  locale: string | null;
  bank_id: string | null;
}

const localHour = (tz: string, now: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));

export async function runReminders(env: AppEnv, now = new Date(), fetchImpl: typeof fetch = fetch) {
  const keys = vapidKeys(env);
  if (!keys) return { sent: 0, gone: 0 };
  const db = env.DB;
  const iso = now.toISOString();
  // ponytail: oldest-sent first with a fixed scan window; page through if a deployment ever has > SCAN live reminders.
  const rows = (
    await db
      .prepare(
        `SELECT r.id, r.household_id, r.user_id, r.kind, r.freq, r.day, r.weekdays, r.hour, r.account_id, r.last_sent_at, r.review_month,
                h.timezone AS tz, COALESCE(u.locale, h.locale) AS locale, a.bank_id AS bank_id
           FROM reminders r
           JOIN households h ON h.id = r.household_id AND h.status = 'active'
           JOIN memberships m ON m.household_id = r.household_id AND m.user_id = r.user_id
           JOIN users u ON u.id = r.user_id
           LEFT JOIN accounts a ON a.id = r.account_id AND a.household_id = r.household_id
          WHERE r.enabled = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = r.user_id)
            AND (r.kind <> 'review' OR r.checked_at IS NULL OR r.checked_at < ?1)
          ORDER BY r.last_sent_at LIMIT ?2`,
      )
      .bind(new Date(now.getTime() - REVIEW_CHECK_EVERY).toISOString(), SCAN)
      .all<DueRow>()
  ).results;

  const due: { r: DueRow; claim: D1PreparedStatement; msg: PushMessage }[] = [];
  const checked: D1PreparedStatement[] = [];
  const reviewMonth = new Map<string, string | null>();
  for (const r of rows) {
    if (r.kind === 'review') {
      const h = localHour(r.tz, now);
      if (h < 9 || h >= 21 || (!reviewMonth.has(r.household_id) && reviewMonth.size >= MAX_REVIEW_CHECKS)) continue;
      if (!reviewMonth.has(r.household_id)) {
        const q = tenantDb(db, r.household_id);
        const hh = (await db.prepare('SELECT * FROM households WHERE id = ?1').bind(r.household_id).first<HouseholdRow>())!;
        const base = await loadBase(q, hh, now);
        reviewMonth.set(r.household_id, base.hasData ? await reviewDue(q, base) : null);
      }
      checked.push(db.prepare('UPDATE reminders SET checked_at = ?2 WHERE id = ?1').bind(r.id, iso));
      const m = reviewMonth.get(r.household_id);
      if (m && m !== r.review_month)
        due.push({
          r,
          claim: db.prepare("UPDATE reminders SET review_month = ?2, last_sent_at = ?3 WHERE id = ?1 AND COALESCE(review_month, '') = ?4").bind(r.id, m, iso, r.review_month ?? ''),
          msg: pushMessage('review', r.locale, reminderUrl({ kind: 'review', month: m }), `review-${m}`),
        });
    } else if (isDue(r, r.tz, now, r.last_sent_at)) {
      due.push({
        r,
        claim: db.prepare('UPDATE reminders SET last_sent_at = ?2 WHERE id = ?1 AND last_sent_at = ?3').bind(r.id, iso, r.last_sent_at),
        msg: pushMessage(r.kind, r.locale, reminderUrl(r), `rem-${r.id}`),
      });
    }
  }
  if (checked.length) await db.batch(checked);
  if (!due.length) return { sent: 0, gone: 0 };

  const users = [...new Set(due.map((d) => d.r.user_id))];
  const subs = (await db.prepare('SELECT * FROM push_subscriptions WHERE user_id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(users)).all<PushSubRow>()).results;
  const byUser = new Map<string, PushSubRow[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  let budget = MAX_PUSHES;
  const picked = due.filter((d) => {
    const n = byUser.get(d.r.user_id)?.length ?? 0;
    if (n > budget) return false;
    budget -= n;
    return true;
  });
  if (!picked.length) return { sent: 0, gone: 0 };
  const claims = await db.batch(picked.map((d) => d.claim));
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    picked.map(async (d, i) => {
      if (!claims[i]!.meta.changes) return; // another run took it
      const r = await sendAll(keys, byUser.get(d.r.user_id) ?? [], d.msg, fetchImpl);
      sent += r.sent;
      gone.push(...r.gone);
    }),
  );
  if (gone.length) await deleteGoneStmt(db, gone).run();
  return { sent, gone: gone.length };
}
