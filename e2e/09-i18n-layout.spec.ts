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

for (const locale of ['en', 'he'] as const) {
  test(`month navigation: "previous" on the start side, chevrons point outward (${locale})`, async ({ page }) => {
    await signIn(page, 'admin', locale);
    for (const route of ['/trends?from=2026-10-01&to=2026-10-31', '/trends?tab=day&from=2026-10-01&to=2026-10-31', '/budget', '/transactions']) {
      await page.goto(route);
      const prev = page.getByTestId('month-prev');
      const next = page.getByTestId('month-next');
      await expect(prev).toBeVisible();
      const [p, n] = [(await prev.boundingBox())!, (await next.boundingBox())!];
      expect(locale === 'he' ? p.x > n.x : p.x < n.x, `${route} prev on start side`).toBe(true);
      // the left-pointing chevron is mirrored in RTL so "previous" points right, towards the start
      expect(await prev.locator('svg').evaluate((s) => getComputedStyle(s).scale)).toBe(locale === 'he' ? '-1 1' : 'none');
    }
    await page.goto('/trends?from=2026-10-01&to=2026-10-31');
    await page.getByTestId('month-prev').click();
    await expect(page).toHaveURL(/from=2026-09-01&to=2026-09-30/);
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
