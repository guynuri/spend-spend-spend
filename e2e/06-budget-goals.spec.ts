import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';
import { expectNoHorizontalOverflow } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

test('add a budget from the sheet; the status colour follows; one-time limit applies to its month only', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/budget?month=2026-10');
  const groceries = () => page.getByTestId('budget-line').filter({ hasText: 'Groceries' });
  await page.getByTestId('budget-add').click();
  await page.getByTestId('budget-category').selectOption({ label: 'Groceries' });
  await page.getByTestId('limit-input').fill('10');
  await page.getByTestId('limit-save').click();
  await expect(groceries()).toHaveAttribute('data-status', 'over');
  await expect(groceries().getByRole('progressbar').locator('div').first()).toHaveClass(/bg-bad/);
  await expect(groceries()).toContainText('Monthly');
  await groceries().getByTestId('limit-edit').click();
  await page.getByTestId('limit-input').fill('100000');
  await page.getByTestId('limit-save').click();
  await expect(groceries()).toHaveAttribute('data-status', 'on_pace');
  await expect(page.getByTestId('budget-summary')).toContainText(/1 on pace/);
  // one-time override for October only
  await groceries().getByTestId('limit-edit').click();
  await page.getByTestId('limit-input').fill('10');
  await page.getByTestId('budget-once').click();
  await page.getByTestId('limit-save').click();
  await expect(groceries()).toHaveAttribute('data-one-time', 'true');
  await expect(groceries()).toHaveAttribute('data-status', 'over');
  await page.getByTestId('month-next').click();
  await expect(groceries()).toHaveAttribute('data-one-time', 'false');
  await page.getByTestId('month-prev').click();
  await groceries().getByTestId('limit-edit').click();
  await page.getByTestId('limit-remove').click();
  await expect(groceries()).toHaveAttribute('data-one-time', 'false');
  await expect(groceries()).toHaveAttribute('data-status', 'on_pace');
  // the limit applies from October on; September stays unbudgeted
  await page.getByTestId('month-prev').click();
  await page.getByTestId('budget-list-unbudgeted').getByTestId('see-all').click();
  await expect(page).toHaveURL(/list=unbudgeted/);
  await expect(page.getByTestId('budget-list-sheet').getByTestId('budget-line').filter({ hasText: 'Groceries' })).toHaveAttribute('data-status', 'none');
  await page.goBack();
  await expect(page.getByTestId('budget-list-sheet')).toBeHidden();
  await expect(page.getByTestId('budget-month')).toContainText('September');
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
  // one period control drives every tab and is remembered on this device
  await page.getByTestId('trend-preset').selectOption('3m');
  await expect(page).toHaveURL(/tab=months&from=\d{4}-\d{2}-01&to=/);
  await page.goto('/trends?tab=day');
  await expect(page.getByTestId('trend-preset')).toHaveValue('3m');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await page.getByTestId('trend-preset').selectOption('custom');
  await page.getByTestId('trend-from').fill('2026-10-05');
  await page.getByTestId('trend-to').fill('2026-10-20');
  await expect(page).toHaveURL(/from=2026-10-05&to=2026-10-20/);
  await expect(page.getByTestId('trend-range-label')).not.toBeEmpty();
});

test('add a goal and a contribution; progress and milestones update', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/goals');
  await page.getByTestId('goal-add').click();
  await page.getByTestId('goal-name').fill('Emergency fund E2E');
  await page.getByTestId('goal-target').fill('10000');
  await page.getByTestId('goal-date').fill('2027-12-31');
  await page.getByTestId('goal-save').click();
  const card = page.getByTestId('goal-card').filter({ hasText: 'Emergency fund E2E' });
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  await card.getByTestId('goal-contribute').click();
  await page.getByTestId('contribution-amount').fill('5000');
  await page.getByTestId('contribution-save').click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(card.getByTestId('goal-milestones')).toContainText('50%');
  await page.goto('/');
  await expect(page.getByTestId('dash-goals')).toContainText('Emergency fund E2E');
});

test('overview shows the cards in order and the health explanation', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/');
  const ids = ['forecast-card', 'pnl-card', 'usual-card', 'insights', 'budget-card', 'dash-goals', 'health-card'];
  const tops: number[] = [];
  for (const id of ids) tops.push((await page.getByTestId(id).first().boundingBox())!.y);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  // A usual month from the imported months: per-category averages, this month next to each.
  const usual = page.getByTestId('usual-card');
  await expect(usual.getByTestId('usual-summary')).toBeVisible();
  await expect(usual.getByTestId('usual-item').first()).toBeVisible();
  // Tapping a part of the bar names it.
  const firstName = (await usual.getByTestId('usual-item').first().locator('bdi').first().textContent())!;
  await usual.getByTestId('usual-bar').getByRole('listitem').first().click();
  await expect(usual.getByTestId('usual-bar-label')).toContainText(firstName);
  await expect(usual.getByTestId('usual-highlights')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('health-open').click();
  await expect(page.getByTestId('health-sheet')).toContainText(/Savings rate/);
});
