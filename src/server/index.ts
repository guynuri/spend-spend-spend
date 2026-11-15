import type { AppEnv } from './env';
import { app } from './app';
import { runCleanup } from './db/cleanup';

export default {
  fetch: app.fetch,
  async scheduled(_ctrl, env, ctx) {
    // eslint-disable-next-line no-restricted-syntax -- cron maintenance runs on global tables only
    ctx.waitUntil(runCleanup(env.DB));
  },
} satisfies ExportedHandler<AppEnv>;
