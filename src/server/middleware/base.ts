import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { routePath } from 'hono/route';
import type { AppCtx } from '../types';
import { HttpError, errorBody } from '../http';

const CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

export const requestId: MiddlewareHandler<AppCtx> = async (c, next) => {
  const rid = crypto.randomUUID().slice(0, 8);
  c.set('rid', rid);
  const t0 = Date.now();
  await next();
  // One line per request; never bodies, query strings, amounts or tokens (PLAN §4.4).
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ rid, method: c.req.method, route: safeRoute(c), status: c.res.status, ms: Date.now() - t0, userId: c.get('userId') }));
};

function safeRoute(c: Parameters<MiddlewareHandler<AppCtx>>[0]) {
  try {
    return routePath(c);
  } catch {
    return 'unknown';
  }
}

export const headers: MiddlewareHandler<AppCtx> = async (c, next) => {
  await secureHeaders({
    contentSecurityPolicy: CSP,
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
    crossOriginEmbedderPolicy: false,
  })(c, async () => {
    await next();
  });
  c.header('Cache-Control', 'no-store');
};

/** Body-size guard (1.5 MB), before any parsing. */
export const bodyLimit: MiddlewareHandler<AppCtx> = async (c, next) => {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > 1_500_000) throw new HttpError(413, 'body_too_large', 'Body too large');
  await next();
};

export function onError(err: Error, c: Parameters<MiddlewareHandler<AppCtx>>[0]) {
  if (err instanceof HttpError) return c.json(errorBody(err.code, err.message, err.details), err.status);
  console.error(JSON.stringify({ rid: c.get('rid'), error: err.name, msg: String(err.message).slice(0, 200) }));
  return c.json(errorBody('internal', 'Internal error'), 500);
}
