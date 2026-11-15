import { expect, test } from '@playwright/test';
import { loadCred, prepPage, registerVia } from './auth';

test.describe.configure({ mode: 'serial' });

test('first run: /setup creates the super-admin with a passkey', async ({ page }) => {
  test.skip(!!loadCred('admin'), 'already bootstrapped in this run');
  await prepPage(page);
  await page.goto('/setup#e2e-bootstrap');
  await expect(page.getByTestId('household-name-input')).toBeVisible();
  await page.getByTestId('household-name-input').fill('Our home');
  await registerVia(page, '/setup#e2e-bootstrap', 'Avi Admin', 'admin');
  await expect(page.getByTestId('tabbar')).toBeVisible();
  await page.goto('/more');
  await expect(page.getByTestId('nav-admin')).toBeVisible();
});

test('second setup attempt is refused', async ({ page }) => {
  await prepPage(page);
  await page.goto('/setup#e2e-bootstrap');
  await expect(page.getByTestId('link-invalid')).toBeVisible();
  const r = await page.request.post('/api/auth/register/options', { data: { token: 'e2e-bootstrap', displayName: 'X' }, headers: { 'x-mz': '1', origin: new URL(page.url()).origin } });
  expect(r.status()).toBe(410);
});
