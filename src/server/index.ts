import type { AppEnv } from './env';
import { app } from './app';
import { runCleanup } from './db/cleanup';
import { runReminders } from './db/reminders';

const CLEANUP_CRON = '17 2 * * *';

export default {
  fetch: app.fetch,
  async scheduled(ctrl, env, ctx) {
    if (ctrl.cron === CLEANUP_CRON)
      // eslint-disable-next-line no-restricted-syntax -- cron maintenance runs on global tables only
      ctx.waitUntil(runCleanup(env.DB));
    else ctx.waitUntil(runReminders(env));
  },
} satisfies ExportedHandler<AppEnv>;
