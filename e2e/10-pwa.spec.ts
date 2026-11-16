import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));

test('manifest has required fields', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m).toMatchObject({ name: 'Money Money Money', display: 'standalone', start_url: '/', scope: '/' });
  const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
  expect((await request.get('/icons/apple-touch-icon.png')).status()).toBe(200);
});

test('app is named Money Money Money (title, manifest, iOS home screen)', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.short_name).toBe('Money Money Money');
  await page.goto('/signin');
  await expect(page).toHaveTitle(/Money Money Money/);
  await expect(page.locator('meta[name=apple-mobile-web-app-title]')).toHaveAttribute('content', 'Money Money Money');
});

test('service worker registers; /api is never cached', async ({ page }) => {
  await signIn(page, 'admin');
  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.scope;
  });
  expect(scope).toMatch(/\/$/);
  const res = await page.request.get('/api/health');
  expect(res.headers()['cache-control']).toBe('no-store');
  const sw = await (await page.request.get('/sw.js')).text();
  expect(sw).toContain('NetworkOnly');
  expect(sw).toMatch(/\^\\\/api\\\//);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.filter((u) => u.startsWith('/api/'))).toEqual([]);
});

test('pages carry security headers', async ({ request }) => {
  const res = await request.get('/');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});
