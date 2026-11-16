/** Worker bindings, vars and secrets. Secrets are optional at the type level. */
export interface AppEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai;
  APP_HOST: string;
  DEFAULT_LOCALE: string;
  AI_PROVIDER: string;
  AI_MODEL: string;
  AI_BASE_URL: string;
  AI_TRAINS_ON_INPUTS: string;
  AI_GLOBAL_DAILY_CALLS: string;
  /** Auth route limit per 5 min per IP (default 20); raised only for local e2e. */
  RATE_LIMIT_AUTH?: string;
  BOOTSTRAP_TOKEN?: string;
  AI_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Web Push (VAPID). Without the key pair reminders are in-app only. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends AppEnv {}
  }
}
