/**
 * Reminder delivery: the 15-minute cron finds due reminders across households, claims them with a
 * conditional UPDATE (so overlapping runs never double-send) and pushes to the user's devices.
 * Bounded per run to stay inside the Workers Free CPU / subrequest limits; leftovers go next run.
 */
import type { AppEnv } from '../env';
import { isDue, type Schedule } from '../../shared/reminders';
import { bankById } from '../../shared/banks';
import { sendPush, vapidKeys, type AuthCache, type PushMessage, type PushTarget, type VapidKeys } from '../lib/webpush';
import { tenantDb } from './tenant';
import type { HouseholdRow } from './rows';
import { deleteGoneStmt, type PushSubRow } from './push';
import { loadBase, type BaseFacts } from './sql/facts';
import { reviewDue } from './sql/review';
import { computeBudget } from './sql/budget';
import { weekRecapFor } from './sql/week';
import { alertText, newBudgetAlerts, parseMarks, recapLine } from '../../shared/domain/alerts';
import { formatMoney, type Locale } from '../../shared/money';

const SCAN = 200;
const MAX_PUSHES = 10; // each push = ECDH keygen + encryption (Workers Free cron CPU budget)
const MAX_REVIEW_CHECKS = 3; // each one loads a household's facts
const REVIEW_CHECK_EVERY = 6 * 3_600_000;
/** Budget alerts are checked hourly in the day; recaps and budget checks load a household's facts too. */
const BUDGET_CHECK_EVERY = 3_600_000;
const MAX_FACT_LOADS = 3;

type Kind = 'import' | 'daily' | 'review' | 'test' | 'budget' | 'recap';
type FixedKind = Exclude<Kind, 'budget' | 'recap'>;
const TEXT: Record<'en' | 'he', Record<FixedKind, [string, string]>> = {
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
  if (r.kind === 'budget') return '/budget';
  if (r.kind === 'recap') return '/';
  if (r.kind === 'review') return r.month ? `/review?month=${r.month}&step=0` : '/review';
  if (r.kind === 'test') return '/settings';
  if (!r.account_id) return '/import';
  return `/import?account=${encodeURIComponent(r.account_id)}${bankById(r.bank_id) ? '&openBank=1' : ''}`;
}

export function pushMessage(kind: FixedKind, locale: string | null, url: string, tag: string): PushMessage {
  const [title, body] = TEXT[locale === 'he' ? 'he' : 'en'][kind];
  return { title, body, url, tag };
}

/** Sends to every target; `failed` counts transient failures (anything but 2xx and 404/410). */
export async function sendAll(keys: VapidKeys, subs: (PushTarget & { id: string })[], msg: PushMessage, fetchImpl: typeof fetch = fetch, auth: AuthCache = new Map()) {
  const st = await Promise.all(subs.map((s) => sendPush(keys, s, msg, fetchImpl, auth).catch(() => 0)));
  const ok = (x: number) => x >= 200 && x < 300;
  const gone = (x: number) => x === 404 || x === 410;
  return { sent: st.filter(ok).length, failed: st.filter((x) => !ok(x) && !gone(x)).length, gone: subs.filter((_, i) => gone(st[i]!)).map((s) => s.id) };
}

interface DueRow extends Schedule {
  id: string;
  household_id: string;
  user_id: string;
  account_id: string | null;
  last_sent_at: string;
  review_month: string | null;
  retry: number;
  tz: string;
  locale: string | null;
  bank_id: string | null;
  currency: string;
  marks: string | null;
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
        `SELECT r.id, r.household_id, r.user_id, r.kind, r.freq, r.day, r.weekdays, r.hour, r.account_id, r.last_sent_at, r.review_month, r.retry, r.marks,
                h.timezone AS tz, COALESCE(u.locale, h.locale) AS locale, a.bank_id AS bank_id, h.currency AS currency
           FROM reminders r
           JOIN households h ON h.id = r.household_id AND h.status = 'active' AND h.id NOT LIKE '~demo-%'
           JOIN memberships m ON m.household_id = r.household_id AND m.user_id = r.user_id
           JOIN users u ON u.id = r.user_id
           LEFT JOIN accounts a ON a.id = r.account_id AND a.household_id = r.household_id
          WHERE r.enabled = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = r.user_id)
            AND (r.kind NOT IN ('review', 'budget') OR r.checked_at IS NULL OR r.checked_at < CASE r.kind WHEN 'review' THEN ?1 ELSE ?3 END)
          ORDER BY r.last_sent_at LIMIT ?2`,
      )
      .bind(new Date(now.getTime() - REVIEW_CHECK_EVERY).toISOString(), SCAN, new Date(now.getTime() - BUDGET_CHECK_EVERY).toISOString())
      .all<DueRow>()
  ).results;

  // Clock reminders first; review checks (each loads a household's facts) only on ticks that send nothing.
  // `release` puts a claimed reminder back for one retry when every device failed transiently.
  const due: { r: DueRow; claim: D1PreparedStatement; release: D1PreparedStatement; msg: PushMessage }[] = [];
  // A household's facts are loaded at most once per tick, and for at most MAX_FACT_LOADS households.
  const facts = new Map<string, { q: ReturnType<typeof tenantDb>; base: BaseFacts }>();
  const factsFor = async (hid: string) => {
    if (facts.has(hid)) return facts.get(hid)!;
    if (facts.size >= MAX_FACT_LOADS) return null;
    const q = tenantDb(db, hid);
    const hh = (await db.prepare('SELECT * FROM households WHERE id = ?1').bind(hid).first<HouseholdRow>())!;
    const f = { q, base: await loadBase(q, hh, now) };
    facts.set(hid, f);
    return f;
  };
  const money = (r: DueRow) => (m: number) => formatMoney(m, { currency: r.currency, locale: (r.locale === 'he' ? 'he' : 'en') as Locale, decimals: 0 });
  const claimClock = (r: DueRow) => ({
    claim: db.prepare('UPDATE reminders SET last_sent_at = ?2 WHERE id = ?1 AND last_sent_at = ?3').bind(r.id, iso, r.last_sent_at),
    release: db.prepare('UPDATE reminders SET last_sent_at = ?2, retry = 1 WHERE id = ?1 AND last_sent_at = ?3').bind(r.id, r.last_sent_at, iso),
  });
  for (const r of rows) {
    if (r.kind !== 'recap' || !isDue(r, r.tz, now, r.last_sent_at)) continue;
    // the recap's text needs the household's week; a household beyond this tick's budget waits for the next tick
    const f = await factsFor(r.household_id);
    if (!f) continue;
    const week = await weekRecapFor(f.q, f.base);
    const he = r.locale === 'he';
    due.push({ r, ...claimClock(r), msg: { title: he ? 'השבוע שלכם' : 'Your week', body: recapLine(week, money(r), r.locale), url: reminderUrl({ kind: 'recap' }), tag: `recap-${r.id}` } });
  }
  for (const r of rows)
    if (r.kind !== 'review' && r.kind !== 'budget' && r.kind !== 'recap' && isDue(r, r.tz, now, r.last_sent_at))
      due.push({
        r,
        claim: db.prepare('UPDATE reminders SET last_sent_at = ?2 WHERE id = ?1 AND last_sent_at = ?3').bind(r.id, iso, r.last_sent_at),
        release: db.prepare('UPDATE reminders SET last_sent_at = ?2, retry = 1 WHERE id = ?1 AND last_sent_at = ?3').bind(r.id, r.last_sent_at, iso),
        msg: pushMessage(r.kind as FixedKind, r.locale, reminderUrl(r), `rem-${r.id}`),
      });
  const checked: D1PreparedStatement[] = [];
  // Budget alerts: hourly in the day (9:00–21:00 local), only on ticks that send nothing else.
  if (!due.length)
    for (const r of rows) {
      if (r.kind !== 'budget') continue;
      const h = localHour(r.tz, now);
      if (h < 9 || h >= 21) continue;
      const f = await factsFor(r.household_id);
      if (!f) continue;
      checked.push(db.prepare('UPDATE reminders SET checked_at = ?2 WHERE id = ?1').bind(r.id, iso));
      if (!f.base.hasData) continue;
      const month = f.base.cal.of(f.base.today);
      const b = await computeBudget(f.q, f.base, month, 1);
      const { alerts, marks } = newBudgetAlerts(b.lines, month, parseMarks(r.marks));
      const next = JSON.stringify(marks);
      if (!alerts.length) {
        if (next !== (r.marks ?? '')) checked.push(db.prepare("UPDATE reminders SET marks = ?2 WHERE id = ?1 AND COALESCE(marks, '') = ?3").bind(r.id, next, r.marks ?? ''));
        continue;
      }
      const { title, body } = alertText(alerts, money(r), r.locale);
      due.push({
        r,
        claim: db.prepare("UPDATE reminders SET marks = ?2, last_sent_at = ?3 WHERE id = ?1 AND COALESCE(marks, '') = ?4").bind(r.id, next, iso, r.marks ?? ''),
        release: db.prepare('UPDATE reminders SET marks = ?2, checked_at = NULL, retry = 1 WHERE id = ?1 AND marks = ?3').bind(r.id, r.marks, next),
        msg: { title, body, url: reminderUrl({ kind: 'budget' }), tag: `budget-${month}` },
      });
    }
  const reviewMonth = new Map<string, string | null>();
  if (!due.length)
    for (const r of rows) {
      if (r.kind !== 'review') continue;
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
          release: db.prepare('UPDATE reminders SET review_month = ?2, checked_at = NULL, retry = 1 WHERE id = ?1 AND review_month = ?3').bind(r.id, r.review_month, m),
          msg: pushMessage('review', r.locale, reminderUrl({ kind: 'review', month: m }), `review-${m}`),
        });
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
  // Claim before sending, so overlapping runs never double-send. A run killed after the claim loses only
  // the push: the in-app card keys off seen_at, not last_sent_at, so it still shows.
  const claims = await db.batch(picked.map((d) => d.claim));
  const auth: AuthCache = new Map();
  let sent = 0;
  const gone: string[] = [];
  const after: D1PreparedStatement[] = [];
  await Promise.all(
    picked.map(async (d, i) => {
      if (!claims[i]!.meta.changes) return; // another run took it
      const r = await sendAll(keys, byUser.get(d.r.user_id) ?? [], d.msg, fetchImpl, auth);
      sent += r.sent;
      gone.push(...r.gone);
      // nothing delivered and something failed transiently → one retry next tick (never after a partial success)
      if (!r.sent && r.failed && !d.r.retry) after.push(d.release);
      else if (d.r.retry) after.push(db.prepare('UPDATE reminders SET retry = 0 WHERE id = ?1').bind(d.r.id));
    }),
  );
  if (gone.length) after.push(deleteGoneStmt(db, gone));
  if (after.length) await db.batch(after);
  return { sent, gone: gone.length };
}
