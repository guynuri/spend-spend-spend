import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

const H = { 'X-MZ': '1' };

test('categories: add from the catalog or a custom name; hide unused ones', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/categories');
  const sheet = page.getByTestId('add-category-sheet');
  await page.getByTestId('category-add').click();
  await sheet.getByTestId('category-suggestion').filter({ hasText: /Pets|חיות מחמד/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('category-chip').filter({ hasText: /Pets|חיות מחמד/ })).toBeVisible();
  await page.getByTestId('category-add').click();
  await expect(sheet.getByTestId('category-suggestion').filter({ hasText: /Pets|חיות מחמד/ })).toHaveCount(0);
  await sheet.getByTestId('category-name').fill('E2E beans');
  await sheet.getByTestId('category-save').click();
  await expect(page.getByTestId('category-chip').filter({ hasText: 'E2E beans' })).toBeVisible();

  await page.getByTestId('hide-unused').click();
  await expect(page.getByTestId('show-hidden')).toBeVisible();
  await expect(page.getByTestId('category-chip').filter({ hasText: 'E2E beans' })).toHaveCount(0);
  await page.getByTestId('show-hidden').check();
  await expect(page.getByTestId('category-chip').filter({ hasText: 'E2E beans' })).toBeVisible();
});

test('AI suggestions: review sheet with reason, approve all, apply', async ({ page }) => {
  await signIn(page, 'admin');
  const acc = (await (await page.request.post('/api/accounts', { headers: H, data: { name: 'E2E AI', type: 'checking' } })).json()) as { id: string };
  const date = new Date().toISOString().slice(0, 10);
  expect((await page.request.post('/api/transactions', { headers: H, data: { date, amountMinor: 4200, direction: 'out', description: 'Zzyzx Gadgets', accountId: acc.id } })).ok()).toBe(true);
  expect((await page.request.post('/api/ai/consent', { headers: H, data: { enabled: true } })).ok()).toBe(true);
  try {
    await page.goto('/transactions?uncategorized=1');
    await page.getByTestId('ai-suggest').click();
    const sheet = page.getByTestId('ai-suggest-sheet');
    await expect(sheet.getByTestId('ai-suggestion').first()).toBeVisible();
    await expect(sheet.getByTestId('ai-reason').first()).toContainText('Mock guess');
    await sheet.getByTestId('ai-approve-all').check();
    await sheet.getByTestId('ai-apply').click();
    await expect(sheet).toBeHidden();
  } finally {
    await page.request.post('/api/ai/consent', { headers: H, data: { enabled: false } });
  }
});
