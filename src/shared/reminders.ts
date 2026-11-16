/** Reminder schedules: payload schema and "when was it last due" (pure, timezone-aware via Intl). */
import { z } from 'zod';
import { addDays, dayOf, dayOfWeek, daysInMonth, monthOf, todayInTz, type DateStr } from './dates';

export const MAX_REMINDERS = 20;
export const MAX_DEVICES = 10;
export const ALL_WEEKDAYS = 127;

const hour = z.number().int().min(0).max(23);
export const reminderInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('import'),
      freq: z.enum(['weekly', 'monthly']),
      day: z.number().int().min(0).max(31),
      hour,
      accountId: z.string().min(1).max(40).nullable().optional(),
    })
    .strict()
    .refine((r) => (r.freq === 'weekly' ? r.day <= 6 : r.day >= 1), { path: ['day'] }),
  z.object({ kind: z.literal('daily'), hour, weekdays: z.number().int().min(1).max(ALL_WEEKDAYS).optional() }).strict(),
  z.object({ kind: z.literal('review') }).strict(),
]);
export type ReminderInput = z.infer<typeof reminderInputSchema>;

/** Push services we deliver to (the Worker POSTs to the endpoint, so anything else is refused). */
const PUSH_HOST = /^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)$/;
export function isPushEndpoint(u: string): boolean {
  let x: URL;
  try {
    x = new URL(u);
  } catch {
    return false;
  }
  return x.protocol === 'https:' && !x.port && !x.username && !x.password && PUSH_HOST.test(x.hostname);
}
const b64u = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint),
  keys: z.object({ p256dh: b64u.min(80).max(100), auth: b64u.min(16).max(32) }),
  label: z.string().trim().max(60).nullable().optional(),
});
export const endpointSchema = z.object({ endpoint: z.string().max(1000) }).strict();

export interface Reminder {
  id: string;
  kind: 'import' | 'daily' | 'review';
  freq: 'weekly' | 'monthly' | null;
  day: number | null;
  weekdays: number;
  hour: number;
  accountId: string | null;
  enabled: boolean;
  /** In-app: a slot passed since the user last saw it. */
  due: boolean;
}
export interface PushDevice {
  id: string;
  endpoint: string;
  label: string | null;
  createdAt: string;
}
export interface RemindersResponse {
  reminders: Reminder[];
  push: { available: boolean; publicKey: string | null };
  devices: PushDevice[];
}

export interface Schedule {
  kind: 'import' | 'daily' | 'review';
  freq: 'weekly' | 'monthly' | null;
  day: number | null;
  weekdays: number;
  hour: number;
}

const fmts = new Map<string, Intl.DateTimeFormat>();
/** UTC offset of `tz` at instant `ms`, in ms (local − UTC). */
function tzOffset(ms: number, tz: string): number {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return local - Math.floor(ms / 1000) * 1000;
}

/** The instant of local `date` at `hour`:00 in `tz`. A time skipped by DST lands an hour later. */
export function zonedTime(date: DateStr, hour: number, tz: string): number {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hour);
  const t = guess - tzOffset(guess, tz);
  return guess - tzOffset(t, tz);
}

export function matchesDay(s: Schedule, d: DateStr): boolean {
  if (s.kind === 'daily') return ((s.weekdays >> dayOfWeek(d)) & 1) === 1;
  if (s.kind !== 'import' || s.day === null) return false;
  if (s.freq === 'weekly') return dayOfWeek(d) === s.day;
  return dayOf(d) === Math.min(s.day, daysInMonth(monthOf(d)));
}

/** The most recent scheduled instant ≤ now (ms), or null (review reminders have no clock schedule). */
export function lastSlot(s: Schedule, tz: string, now: Date): number | null {
  const today = todayInTz(tz, now);
  for (let i = 0; i <= 32; i++) {
    const d = addDays(today, -i);
    if (!matchesDay(s, d)) continue;
    const t = zonedTime(d, s.hour, tz);
    if (t <= now.getTime()) return t;
  }
  return null;
}

/** Due when a slot passed after `since` (ISO): the cron's last send, or the user's last dismissal. */
export const isDue = (s: Schedule, tz: string, now: Date, since: string): boolean => {
  const t = lastSlot(s, tz, now);
  return t !== null && t > Date.parse(since);
};
