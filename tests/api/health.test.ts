import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const f = (path: string, init?: RequestInit) => exports.default.fetch(`http://example.com${path}`, init);

describe('GET /api/health', () => {
  it('reports ok and db, with no-store and security headers', async () => {
    const res = await f('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
  });
  it('unknown API route → 404 JSON error envelope', async () => {
    const res = await f('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
