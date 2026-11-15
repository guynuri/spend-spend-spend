/** Screenshots of review chapters in both locales, for visual review. */
import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));
for (const locale of ['en', 'he'] as const)
  test(`review chapters in ${locale}`, async ({ page }) => {
    await signIn(page, 'admin', locale);
    for (const [i, ch] of ['summary', 'spending', 'wrapup'].entries()) {
      await page.goto(`/review?month=2026-10&step=${[0, 2, 6][i]}`);
      await expect(page.getByTestId(`chapter-${ch}`)).toBeVisible();
      await page.screenshot({ path: `e2e/screenshots/${locale}/review-${ch}.png`, fullPage: true });
    }
  });
