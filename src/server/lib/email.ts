import type { AppEnv } from '../env';

/** Optional invite email via Resend (PLAN §7). Silently skipped when not configured. */
export async function sendInviteEmail(env: AppEnv, to: string, link: string, householdName: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: `Maazan — ${householdName}`,
        text: `You were invited to ${householdName} on Maazan.\nOpen this link in Safari (or your phone's browser) to join:\n${link}\n\nהוזמנת להצטרף ל־${householdName} במאזן. יש לפתוח את הקישור:\n${link}\n`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
