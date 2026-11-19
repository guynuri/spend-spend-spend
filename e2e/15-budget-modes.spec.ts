/** Budget modes: a general-expenses category joins the shared line; an occasional one gets a yearly budget. */
import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';
import { expectNoHorizontalOverflow } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

const setMode = async (page: import('@playwright/test').Page, name: string, mode: 'monthly' | 'general' | 'occasional') => {
  await page.goto('/categories');
  await page.getByTestId('category-chip').filter({ hasText: name }).first().click();
  await page.getByTestId('category-mode').selectOption(mode);
  await expect(page.getByTestId('category-mode-hint')).toBeVisible();
  await page.getByTestId('category-save').click();
  await expect(page.getByTestId('category-mode')).toBeHidden();
};

test('general expenses share one budget line; occasional categories get a yearly budget', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'admin');
  await setMode(page, 'Leisure', 'general');
  await setMode(page, 'Home', 'occasional');
  await expect(page.getByTestId('category-chip').filter({ hasText: 'Leisure' })).toContainText('General');

  await page.goto('/budget?month=2026-10');
  // the pooled line is offered in "Add budget" like a category
  await page.getByTestId('budget-add').click();
  await page.getByTestId('budget-category').selectOption('general');
  await page.getByTestId('limit-input').fill('10');
  await page.getByTestId('limit-save').click();
  // over budget → listed first among the variable budgets
  const general = page.getByTestId('budget-list-variable').locator('[data-testid="budget-line"][data-category="general"]');
  await expect(general).toContainText('General expenses');
  await expect(general).toContainText('Monthly');
  await expect(general.getByTestId('general-members')).toContainText('Leisure');
  await general.locator('button').first().click();
  await expect(page.getByTestId('general-breakdown')).toContainText('Leisure');
  await page.screenshot({ path: 'e2e/screenshots/en/state-budget-general.png' });
  await page.keyboard.press('Escape');

  const occ = page.getByTestId('budget-occasional');
  await expect(occ).toContainText('Home');
  await occ.getByTestId('yearly-edit').first().click();
  await page.getByTestId('yearly-input').fill('20000');
  await page.getByTestId('yearly-save').click();
  await expect(occ).toContainText('/ year');
  await expectNoHorizontalOverflow(page);
  await occ.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/en/state-budget-occasional.png' });

  await page.goto('/trends?tab=months&from=2026-01-01&to=2026-12-31');
  await expect(page.getByTestId('trend-occasional')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('trend-occasional').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/en/state-trends-occasional.png' });

  // back to how the other specs expect them
  await setMode(page, 'Leisure', 'monthly');
  await setMode(page, 'Home', 'monthly');
});
