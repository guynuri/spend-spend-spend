import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));

test('app shell loads (desktop sidebar or phone tab bar)', async ({ page }) => {
  await signIn(page, 'admin');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-overview.png`, fullPage: false });
  const res = await page.request.get('/api/health');
  expect(await res.json()).toMatchObject({ ok: true, db: true });
});
