import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

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
  await expect(page.getByTestId('hide-unused-list')).toContainText('E2E beans');
  await page.getByTestId('hide-unused-confirm-ok').click();
  await expect(page.getByTestId('show-hidden')).toBeVisible();
  await expect(page.getByTestId('category-chip').filter({ hasText: 'E2E beans' })).toHaveCount(0);
  await page.getByTestId('show-hidden').check();
  await expect(page.getByTestId('category-chip').filter({ hasText: 'E2E beans' })).toBeVisible();
});

test('subcategories: add one inside a category with its own emoji; it is listed under its parent', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/categories');
  await page.getByTestId('category-chip').filter({ hasText: /^.*(Groceries|סופר ומכולת)/ }).first().click();
  await page.getByTestId('category-add-sub').click();
  const sheet = page.getByTestId('add-category-sheet');
  await expect(sheet).toContainText(/Groceries|סופר ומכולת/);
  await sheet.getByTestId('category-name').fill('E2E organic');
  await sheet.getByTestId('look-emoji').filter({ hasText: '🥗' }).click();
  await sheet.getByTestId('look-color').nth(2).click();
  await sheet.getByTestId('category-save').click();
  await expect(sheet).toBeHidden();
  const subs = page.getByTestId('category-subs');
  await expect(subs.getByTestId('category-chip').filter({ hasText: 'E2E organic' })).toContainText('🥗');
  // a subcategory's budget settings come from its parent
  await subs.getByTestId('category-chip').filter({ hasText: 'E2E organic' }).click();
  await expect(page.getByTestId('category-follows')).toBeVisible();
  await expect(page.getByTestId('category-mode')).toHaveCount(0);
});

test('AI suggestions: review sheet with reason, approve all, apply', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions');
  const H = { 'x-mz': '1', origin: new URL(page.url()).origin };
  const acc = ((await (await page.request.get('/api/accounts')).json()) as { accounts: { id: string }[] }).accounts[0]!;
  const date = new Date().toISOString().slice(0, 10);
  const tx = await page.request.post('/api/transactions', { headers: H, data: { date, amountMinor: 4200, direction: 'out', description: 'Zzyzx Gadgets', accountId: acc.id } });
  expect(tx.ok(), await tx.text()).toBe(true);
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

test.describe('without the service worker', () => {
  // page.route can't see requests a service worker handles.
  test.use({ serviceWorkers: 'block' });
  test('a slow save shows it is working: button spinner and the progress line', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/categories');
    await page.route('**/api/categories', async (r) => {
      if (r.request().method() === 'POST') await new Promise((ok) => setTimeout(ok, 1500));
      await r.continue();
    });
    await page.getByTestId('category-add').click();
    const sheet = page.getByTestId('add-category-sheet');
    await sheet.getByTestId('category-name').fill('E2E slow save');
    await sheet.getByTestId('category-save').click();
    await expect(sheet.getByTestId('category-save')).toBeDisabled();
    await expect(page.getByTestId('mutation-progress')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('category-chip').filter({ hasText: 'E2E slow save' })).toBeVisible();
    await expect(page.getByTestId('mutation-progress')).toHaveAttribute('data-active', 'false');
  });
});
