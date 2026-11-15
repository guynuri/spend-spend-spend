import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

test('set a budget inline; the status colour follows', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/budget?month=2026-10');
  const line = page.getByTestId('budget-line').filter({ hasText: 'Groceries' });
  await expect(line).toHaveAttribute('data-status', 'none');
  await line.getByTestId('limit-edit').click();
  await line.getByTestId('limit-input').fill('10');
  await line.getByTestId('limit-save').click();
  await expect(page.getByTestId('budget-line').filter({ hasText: 'Groceries' })).toHaveAttribute('data-status', 'over');
  await expect(page.getByTestId('budget-line').filter({ hasText: 'Groceries' }).getByRole('progressbar').locator('div').first()).toHaveClass(/bg-bad/);
  const l2 = page.getByTestId('budget-line').filter({ hasText: 'Groceries' });
  await l2.getByTestId('limit-edit').click();
  await l2.getByTestId('limit-input').fill('100000');
  await l2.getByTestId('limit-save').click();
  await expect(page.getByTestId('budget-line').filter({ hasText: 'Groceries' })).toHaveAttribute('data-status', 'on_pace');
  await expect(page.getByTestId('budget-summary')).toContainText(/1 on pace/);
  // the limit applies from October on; September stays unbudgeted
  await page.getByTestId('month-prev').click();
  await expect(page.getByTestId('budget-line').filter({ hasText: 'Groceries' })).toHaveAttribute('data-status', 'none');
});

test('unsplit card banner links to the card charges', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/budget?month=2026-11');
  await expect(page.getByTestId('unsplit-banner')).toBeVisible();
  await page.getByTestId('unsplit-cta').click();
  await expect(page).toHaveURL(/kind=card_lump/);
  await expect(page.getByTestId('tx-row').first()).toBeVisible();
});

test('trends: tapping a category opens the filtered ledger', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/trends?month=2026-10');
  await expect(page.getByTestId('trend-category').first()).toBeVisible();
  await page.getByTestId('trend-category').first().click();
  await expect(page).toHaveURL(/\/transactions\?from=2026-10-01&to=2026-10-31&(category|uncategorized)=/);
  await page.goto('/trends?month=2026-10&tab=day');
  await expect(page.getByRole('img').first()).toBeVisible();
  await page.goto('/trends?tab=months');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
});
