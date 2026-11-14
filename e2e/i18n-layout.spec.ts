import { expect, test } from '@playwright/test';
import { MAIN_ROUTES, expectNoHorizontalOverflow, routeSlug, setLocale } from './helpers';

for (const locale of ['en', 'he'] as const) {
  test.describe(`layout ${locale}`, () => {
    test.beforeEach(async ({ page }) => setLocale(page, locale));

    for (const route of MAIN_ROUTES) {
      test(`${route} fits 390 px, tab bar visible, dir correct`, async ({ page }) => {
        await page.goto(route);
        await expect(page.getByTestId('app-root')).toBeVisible();
        await expect(page.getByTestId('tabbar')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: `e2e/screenshots/${locale}/${routeSlug(route)}.png`, fullPage: true });
      });
    }
  });
}

test('Hebrew label and switching locale from settings', async ({ page }) => {
  await setLocale(page, 'en');
  await page.goto('/settings');
  await expect(page.getByTestId('tab-budget')).toContainText('Budget');
  await page.getByTestId('locale-switch').getByRole('radio').nth(1).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('tab-budget')).toContainText('תקציב');
});

test('safe-area padding and 16px inputs', async ({ page }) => {
  await setLocale(page, 'en');
  await page.goto('/settings');
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).toContain('viewport-fit=cover');
  const tabbarPad = await page.getByTestId('tabbar').evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(tabbarPad).toBeDefined();
  const css = await page.evaluate(() =>
    [...document.styleSheets].flatMap((s) => {
      try {
        return [...s.cssRules].map((r) => r.cssText);
      } catch {
        return [];
      }
    }).join('\n'),
  );
  expect(css).toContain('safe-area-inset-bottom');
  expect(css).toContain('safe-area-inset-top');
  const fs = await page.evaluate(() => {
    const i = document.createElement('input');
    document.body.appendChild(i);
    const v = getComputedStyle(i).fontSize;
    i.remove();
    return v;
  });
  expect(parseFloat(fs)).toBeGreaterThanOrEqual(16);
});
