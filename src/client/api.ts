/** Thin JSON client. Every non-GET sends the CSRF header and JSON content type (PLAN §7). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** App tour: while set, GETs read the generated demo household (X-MZ-Demo) and writes are refused here. */
let demo: 'en' | 'he' | null = null;
export const setDemo = (l: 'en' | 'he' | null) => {
  demo = l;
};

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (demo && method !== 'GET') throw new ApiError(403, 'demo_read_only', 'Demo data is read-only');
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? { Accept: 'application/json', ...(demo && { 'X-MZ-Demo': demo }) } : { 'Content-Type': 'application/json', 'X-MZ': '1', 'X-MZ-Locale': document.documentElement.lang || 'en', Accept: 'application/json' },
      body: method === 'GET' || body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'network error');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body);
export const put = <T,>(path: string, body?: unknown) => api<T>('PUT', path, body);
export const patch = <T,>(path: string, body?: unknown) => api<T>('PATCH', path, body);
export const del = <T,>(path: string, body?: unknown) => api<T>('DELETE', path, body);

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function errorKey(e: unknown): string {
  if (e instanceof ApiError) return `errors.${e.code}`;
  return 'errors.unknown';
}
