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
  const ids = ['forecast-card', 'pnl-card', 'insights', 'budget-card', 'dash-goals', 'health-card'];
  const tops: number[] = [];
  for (const id of ids) tops.push((await page.getByTestId(id).first().boundingBox())!.y);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  await page.getByTestId('health-open').click();
  await expect(page.getByTestId('health-sheet')).toContainText(/Savings rate/);
});
