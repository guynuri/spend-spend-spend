import { expect, test, type Page } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

const eom = async (page: Page) => Number(await page.getByTestId('forecast-eom').getAttribute('data-minor'));

test('planned expense of ₪1,234 lowers the month-end figure by exactly ₪1,234', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/forecast');
  await expect(page.getByTestId('forecast-card')).toBeVisible();
  const before = await eom(page);
  const today = await page.evaluate(() => fetch('/api/me').then((r) => r.json()).then((m) => m.active.today as string));
  await page.getByTestId('planned-add').click();
  await page.getByTestId('planned-name').fill('Birthday gift');
  await page.getByTestId('planned-amount').fill('1234');
  await page.getByTestId('planned-date').fill(today);
  await page.getByTestId('planned-from').selectOption({ label: 'Main checking' });
  await page.getByTestId('planned-save').click();
  await expect(page.getByTestId('planned-list')).toContainText('Birthday gift');
  await expect.poll(() => eom(page)).toBe(before - 123400);
});

test('card charge override changes the forecast; explain rows add up to the figure', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/recurring');
  await page.getByTestId('recurring-add').click();
  await page.getByTestId('recurring-name').fill('Isracard E2E');
  await page.locator('#rc-kind').selectOption('card_charge');
  await page.getByTestId('recurring-amount').fill('7000');
  await page.locator('#rc-anchor').fill('2026-01-10');
  await page.getByTestId('recurring-day').fill('28');
  await page.locator('#rc-acc').selectOption({ label: 'Main checking' });
  await page.getByTestId('recurring-save').click();
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'Isracard E2E' })).toBeVisible();

  await page.goto('/forecast');
  const before = await eom(page);
  await page.goto('/upcoming');
  const card = page.getByTestId('upcoming-item').filter({ hasText: 'Isracard E2E' }).first();
  await card.click();
  await page.getByTestId('occurrence-amount').fill('1000');
  await page.getByTestId('occurrence-save').click();
  await expect(page.getByTestId('occurrence-sheet')).toBeHidden();
  await expect(page.getByTestId('upcoming-item').filter({ hasText: 'Isracard E2E' }).first()).toContainText(/Your amount/);
  await page.goto('/forecast');
  const after = await eom(page);
  expect(after).not.toBe(before);

  await page.getByTestId('explain-forecast-open').click();
  const sheet = page.getByTestId('explain-forecast');
  let total = 0;
  for (const id of ['row-start', 'row-income', 'row-recurring', 'row-card', 'row-planned', 'row-actuals', 'row-variable']) total += Number(await sheet.getByTestId(id).locator('[data-minor]').getAttribute('data-minor'));
  expect(total).toBe(Number(await sheet.getByTestId('row-eom').locator('[data-minor]').getAttribute('data-minor')));
  expect(total).toBe(after);
});
