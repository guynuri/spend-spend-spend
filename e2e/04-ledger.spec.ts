import { expect, test, type Page } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';
import { ensureAccountNamed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

async function ensureAccount(page: Page) {
  return ensureAccountNamed(page, 'Main checking');
}

async function closeSheet(page: Page, testId: string) {
  await page.getByTestId(testId).getByRole('button', { name: /close|סגירה/i }).click();
  await expect(page.getByTestId(testId)).toBeHidden();
}

async function addTx(page: Page, amount: string, description: string) {
  await page.getByTestId('ledger-add').click();
  await page.getByTestId('add-amount').fill(amount);
  await page.getByTestId('add-description').fill(description);
  await page.getByTestId('add-tx-save').click();
  await expect(page.getByTestId('add-tx')).toBeHidden();
}

test('add manual transactions; categorizing one learns and categorizes the rest, with undo', async ({ page }) => {
  await signIn(page, 'admin');
  await ensureAccount(page);
  await page.goto('/transactions');
  for (const a of ['42.50', '38', '51.20']) await addTx(page, a, 'Cafe Roma E2E');
  const rows = page.getByTestId('tx-row').filter({ hasText: 'Cafe Roma E2E' });
  await expect(rows).toHaveCount(3);
  await rows.first().click();
  const sheet = page.getByTestId('tx-sheet');
  await sheet.getByTestId('tx-category').selectOption({ label: 'Eating out' });
  await expect(page.getByTestId('toast').filter({ hasText: /2 more categorized/ })).toBeVisible();
  await closeSheet(page, 'tx-sheet');
  await page.getByTestId('ledger-search').fill('cafe roma e2e');
  await expect(page).toHaveURL(/q=cafe\+roma\+e2e/);
  await page.getByTestId('ledger-filters').click();
  await page.getByTestId('filter-uncategorized').click();
  await expect(page.getByTestId('filter-uncategorized')).toBeChecked();
  await closeSheet(page, 'filters-sheet');
  await expect(page.getByTestId('tx-row')).toHaveCount(0);
  // filter state survives reload (URL)
  await page.reload();
  await expect(page.getByTestId('ledger-search')).toHaveValue('cafe roma e2e');
  await expect(page).toHaveURL(/uncategorized=1/);
  await expect(page.getByTestId('tx-row')).toHaveCount(0);
  // Clear filters also clears the search box (review fix)
  await page.getByTestId('ledger-filters').click();
  await page.getByTestId('filters-sheet').getByRole('button', { name: /clear filters/i }).click();
  await closeSheet(page, 'filters-sheet');
  await expect(page.getByTestId('ledger-search')).toHaveValue('');
  // An empty period in the URL falls back to the current month
  await page.goto('/transactions?from=&to=');
  await expect(page.getByTestId('ledger-range')).not.toBeEmpty();
  await expect(page.getByTestId('ledger-summary')).toBeVisible();
});

test('undo of a learned categorization reverts the others', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions?q=undo+me+e2e');
  for (const a of ['10', '11']) await addTx(page, a, 'Undo Me E2E');
  await page.getByTestId('tx-row').first().click();
  await page.getByTestId('tx-sheet').getByTestId('tx-category').selectOption({ label: 'Leisure' });
  await page.getByTestId('toast-action').click();
  await closeSheet(page, 'tx-sheet');
  await page.goto('/transactions?q=undo+me+e2e&uncategorized=1');
  await expect(page.getByTestId('tx-row')).toHaveCount(1);
});

test('split a card charge into categories', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions?q=isracard');
  await addTx(page, '1000', 'ISRACARD E2E charge');
  await page.getByTestId('tx-row').filter({ hasText: 'ISRACARD E2E' }).first().click();
  await page.getByTestId('tx-split').click();
  const lines = page.getByTestId('split-line');
  await lines.nth(0).locator('select').selectOption({ label: 'Groceries' });
  await lines.nth(0).locator('input').fill('600');
  await lines.nth(1).locator('select').selectOption({ label: 'Home' });
  await lines.nth(1).locator('input').fill('300');
  await expect(page.getByTestId('split-save')).toBeDisabled();
  await lines.nth(1).locator('input').fill('400');
  await expect(page.getByTestId('split-remaining')).toHaveAttribute('class', /text-good/);
  await page.getByTestId('split-save').click();
  await expect(page.getByTestId('tx-sheet')).toBeHidden();
  await expect(page.getByTestId('tx-row').filter({ hasText: 'ISRACARD E2E' }).first()).toContainText(/Split/);
});

test('bulk categorize and CSV export', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions?q=bulk+e2e');
  for (const a of ['5', '6']) await addTx(page, a, `Bulk E2E ${a}`);
  await page.getByTestId('ledger-select').click();
  for (const r of await page.getByTestId('tx-row').all()) await r.click();
  await page.getByTestId('bulk-category').selectOption({ label: 'Health' });
  await page.getByTestId('bulk-apply').click();
  await expect(page.getByTestId('toast').filter({ hasText: /2 transactions updated/ })).toBeVisible();
  const res = await page.request.get('/api/transactions/export.csv?q=bulk+e2e');
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('Bulk E2E 5');
});
