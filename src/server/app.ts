import { Hono } from 'hono';
import { APP_VERSION } from '../shared/app';
import type { AppCtx } from './types';
import { pingDb } from './db/ping';
import { bodyLimit, headers, onError, requestId } from './middleware/base';
import { errorBody } from './http';

export function createApp() {
  const app = new Hono<AppCtx>();
  app.use('/api/*', requestId, headers);
  app.onError(onError);
  app.use('/api/*', bodyLimit);

  app.get('/api/health', async (c) => {
    // eslint-disable-next-line no-restricted-syntax -- the health check is the one non-tenant DB probe
    const db = await pingDb(c.env.DB);
    return c.json({ ok: true, version: APP_VERSION, db });
  });

  app.all('/api/*', (c) => c.json(errorBody('not_found', 'No such API route'), 404));
  return app;
}

export const app = createApp();
