import { Hono } from 'hono';
import { APP_VERSION } from '../shared/app';
import type { AppEnv } from './env';
import { pingDb } from './db/ping';

const app = new Hono<{ Bindings: AppEnv }>();

app.get('/api/health', async (c) => {
  // eslint-disable-next-line no-restricted-syntax -- the health check is the one non-tenant DB probe
  const db = await pingDb(c.env.DB);
  return c.json({ ok: true, version: APP_VERSION, db });
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<AppEnv>;
