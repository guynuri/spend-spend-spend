import { expect, test } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  const res = await page.request.get('/api/health');
  expect(await res.json()).toMatchObject({ ok: true, db: true });
});
