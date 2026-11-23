import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';
import { ensureAccountNamed, expectNoHorizontalOverflow } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

for (const locale of ['en', 'he'] as const) {
  test(`add sheet fits the phone and opens from the bar (${locale})`, async ({ page }) => {
    await signIn(page, 'admin', locale);
    await ensureAccountNamed(page, 'Main checking');
    await page.goto('/budget');
    await page.getByTestId('tab-add').click();
    const sheet = page.getByTestId('add-tx');
    // quick add: amount and categories up front; date / account behind "More details"
    await expect(sheet.getByTestId('add-amount')).toBeFocused();
    await expect(sheet.getByTestId('quick-cat').first()).toBeVisible();
    await expect(sheet.getByTestId('add-date')).toHaveCount(0);
    await sheet.getByTestId('add-details').click();
    await expect(sheet.getByTestId('add-date')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const s = (await sheet.boundingBox())!;
    for (const id of ['add-date', 'add-amount', 'add-description']) {
      const b = (await sheet.getByTestId(id).boundingBox())!;
      expect(b.x, id).toBeGreaterThanOrEqual(s.x);
      expect(b.x + b.width, id).toBeLessThanOrEqual(s.x + s.width);
    }
    // the income/expense toggle is centered
    const seg = (await sheet.getByRole('radiogroup').first().boundingBox())!;
    expect(Math.abs(seg.x + seg.width / 2 - (s.x + s.width / 2))).toBeLessThan(2);
  });
}

test('quick add: amount, one tap on a category, save; the category comes first next time', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions');
  await page.getByTestId('tab-add').click();
  const sheet = page.getByTestId('add-tx');
  await sheet.getByTestId('add-amount').fill('42');
  const cat = sheet.getByTestId('quick-cat').nth(2);
  const name = (await cat.locator('span').last().textContent())!.trim();
  await cat.click();
  await expect(cat).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('add-tx-save')).toContainText('42');
  await sheet.getByTestId('add-tx-save').click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('tx-row').first()).toContainText(name);
  await page.getByTestId('tab-add').click();
  await expect(page.getByTestId('add-tx').getByTestId('quick-cat').first()).toContainText(name);
  // "All" opens every category as icons, in place (no drop-down)
  const add = page.getByTestId('add-tx');
  await add.getByTestId('quick-cat-more').click();
  expect(await add.getByTestId('quick-cat').count()).toBeGreaterThan(7);
  await expect(add.locator('select')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('a transaction without description shows at the top of the ledger without reload', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions');
  await expect(page.getByTestId('ledger-summary')).toBeVisible();
  for (const amount of ['17.30', '17.40']) {
    await page.getByTestId('tab-add').click();
    await page.getByTestId('add-amount').fill(amount);
    await expect(page.getByTestId('add-tx-save')).toBeEnabled();
    await page.getByTestId('add-tx-save').click();
    await expect(page.getByTestId('add-tx')).toBeHidden();
    const first = page.getByTestId('tx-row').first();
    await expect(first).toContainText(amount);
    await expect(first).toContainText('No description');
  }
});

test('choose bottom bar pages in settings', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings');
  await page.getByTestId('navbar-slot-2').selectOption('/upcoming');
  const bar = page.getByTestId('tabbar');
  await expect(bar.getByTestId('tab-upcoming')).toBeVisible();
  await expect(bar.getByTestId('tab-budget')).toHaveCount(0);
  await page.getByTestId('navbar-settings').getByRole('button', { name: 'Move up' }).nth(2).click();
  await expect(page.getByTestId('navbar-slot-1')).toHaveValue('/upcoming');
  await page.reload();
  await expect(bar.getByTestId('tab-upcoming')).toBeVisible();
  await bar.getByTestId('tab-more').click();
  await expect(page.getByTestId('nav-budget')).toBeVisible();
  await expect(page.getByTestId('nav-upcoming')).toHaveCount(0);
  // badges of pages moved off the bar move to More (uncategorized rows exist from the test above)
  await page.goto('/settings');
  await page.getByTestId('navbar-slot-2').selectOption('/goals');
  await expect(bar.getByTestId('tab-transactions')).toHaveCount(0);
  await expect(bar.getByTestId('badge-more')).toBeVisible();
  await bar.getByTestId('tab-more').click();
  await expect(page.getByTestId('nav-transactions').getByTestId('badge-uncategorized')).toBeVisible();
  await page.goto('/settings');
  await page.getByTestId('navbar-reset').click();
  await expect(bar.getByTestId('tab-budget')).toBeVisible();
  await expect(bar.getByTestId('tab-upcoming')).toHaveCount(0);
});
