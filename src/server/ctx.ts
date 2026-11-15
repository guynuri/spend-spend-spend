import type { Ctx } from './types';

/** Tenant context set by the household middleware. */
export function tctx(c: Ctx) {
  const db = c.get('db');
  const hh = c.get('household');
  const userId = c.get('userId');
  if (!db || !hh || !userId) throw new Error('tenant context missing');
  return { db, hh, userId, role: c.get('role')! };
}
export const originOf = (c: Ctx) => new URL(c.req.url).origin;
