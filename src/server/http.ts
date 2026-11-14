import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new HttpError(404, 'not_found', 'Not found');
export const badRequest = (code = 'validation', details?: unknown) => new HttpError(400, code, 'Bad request', details);
export const forbidden = (code = 'forbidden') => new HttpError(403, code, 'Forbidden');
export const gone = (code = 'gone') => new HttpError(410, code, 'Gone');

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Parse a JSON body with zod; 400 `validation` with flattened issues on failure. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('invalid_json');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw badRequest('validation', r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })));
  return r.data;
}

export function query<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw badRequest('validation', r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })));
  return r.data;
}
