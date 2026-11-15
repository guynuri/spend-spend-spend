import { expect, type Page } from '@playwright/test';

export const MAIN_ROUTES = ['/', '/transactions', '/budget', '/upcoming', '/more', '/forecast', '/recurring', '/accounts', '/goals', '/trends', '/review', '/import', '/household', '/settings', '/admin', '/categories'];

export async function setLocale(page: Page, locale: 'en' | 'he') {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem('mz_locale', l);
      localStorage.setItem('mz_hint_install', '1');
    } catch {
      /* ignore */
    }
  }, locale);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, 'horizontal overflow').toBeLessThanOrEqual(r.cw);
}

export const routeSlug = (r: string) => (r === '/' ? 'overview' : r.slice(1).replace(/\//g, '_'));

import type { Page as P } from '@playwright/test';
/** Creates an account through the UI if none with that name exists. */
export async function ensureAccountNamed(page: P, name: string) {
  await page.goto('/accounts');
  await expect(page.getByTestId('account-add')).toBeVisible();
  if ((await page.getByTestId('account-card').filter({ hasText: name }).count()) > 0) return;
  await page.getByTestId('account-add').click();
  await page.getByTestId('account-name').fill(name);
  await page.getByTestId('account-save').click();
  await expect(page.getByTestId('account-card').filter({ hasText: name })).toHaveCount(1);
}
export const FIX = 'fixtures/otsar-hahayal/synthetic';
