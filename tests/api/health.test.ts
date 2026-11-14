import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('reports ok and db', async () => {
    void env;
    const res = await exports.default.fetch('http://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: true });
  });
});
