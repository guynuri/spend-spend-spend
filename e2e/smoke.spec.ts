import { expect, test } from '@playwright/test';

test('app shell loads (desktop sidebar or phone tab bar)', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('app-root')).toBeVisible();
  const res = await page.request.get('/api/health');
  expect(await res.json()).toMatchObject({ ok: true, db: true });
});
