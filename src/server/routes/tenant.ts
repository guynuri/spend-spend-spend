import { Hono } from 'hono';
import type { AppCtx } from '../types';
import { household, roleDefault } from '../middleware/auth';

/** A route group behind session + household + role middleware (every tenant route). */
export function tenantGroup() {
  const r = new Hono<AppCtx>();
  r.use('*', household, roleDefault);
  return r;
}
