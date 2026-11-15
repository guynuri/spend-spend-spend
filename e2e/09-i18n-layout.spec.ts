import { expect, test } from '@playwright/test';
import { MAIN_ROUTES, expectNoHorizontalOverflow, routeSlug } from './helpers';
import { ensureAdmin, signIn } from './auth';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));

for (const locale of ['en', 'he'] as const) {
  test(`all main routes fit 390 px in ${locale}; tab bar visible; dir correct`, async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin', locale);
    for (const route of MAIN_ROUTES) {
      await page.goto(route);
      await expect(page.getByTestId('app-root')).toBeVisible();
      await expect(page.getByTestId('tabbar')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('status').filter({ hasText: /Loading|טוען/ })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${locale}/${routeSlug(route)}.png`, fullPage: true });
    }
  });
}

test('Hebrew label and switching locale from settings', async ({ page }) => {
  await signIn(page, 'admin', 'en');
  await page.goto('/settings');
  await expect(page.getByTestId('tab-budget')).toContainText('Budget');
  await page.getByTestId('locale-switch').getByRole('radio').nth(1).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('tab-budget')).toContainText('תקציב');
  // persisted to the profile: a reload stays Hebrew even with English in localStorage
  await page.evaluate(() => localStorage.setItem('mz_locale', 'en'));
  await page.reload();
  await expect(page.getByTestId('tab-budget')).toContainText('תקציב');
  await page.getByTestId('locale-switch').getByRole('radio').nth(0).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('safe-area padding and 16px inputs', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings');
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).toContain('viewport-fit=cover');
  const css = await page.evaluate(() =>
    [...document.styleSheets]
      .flatMap((s) => {
        try {
          return [...s.cssRules].map((r) => r.cssText);
        } catch {
          return [];
        }
      })
      .join('\n'),
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

test('tour runs in the sign-in language and each page reopens its entry', async ({ page }) => {
  await signIn(page, 'admin', 'he');
  // runs after prepPage's init script, so the tour counts as not seen on every full load
  await page.addInitScript(() => localStorage.removeItem('mz_tour_done'));
  await page.goto('/');
  await expect(page.getByTestId('tour-welcome')).toContainText('סיור');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-page-overview')).toBeVisible();
  await page.getByTestId('tour-next').click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByTestId('tour-page-transactions')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await page.getByTestId('tab-budget').click();
  await page.getByTestId('page-tour').click();
  await expect(page.getByTestId('tour-page-budget')).toContainText('תקציב');
});
