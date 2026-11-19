/** Card accounts (D-R20): a card file goes into a credit-card account; live card tracking key in Settings. */
import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ensureAdmin, signIn } from './auth';
import { ensureAccountNamed, expectNoHorizontalOverflow } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

function maxFile() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['כל המשתמשים (1)'],
      ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', '4 ספרות אחרונות של כרטיס האשראי', 'סוג עסקה', 'סכום חיוב', 'מטבע חיוב', 'סכום עסקה מקורי', 'מטבע עסקה מקורי', 'תאריך חיוב', 'הערות'],
      ['04-10-2026', 'רמי לוי', 'מזון', '1111', 'רגילה', 245.9, '₪', 245.9, '₪', '10-11-2026', null],
      ['12-10-2026', 'ZARA ONLINE', 'אופנה', '1111', 'רגילה', 180, '₪', 180, '₪', '10-11-2026', null],
    ]),
    'Sheet1',
  );
  return Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
}

test('a Max file creates and fills a credit-card account', async ({ page }) => {
  await signIn(page, 'admin');
  await ensureAccountNamed(page, 'Checking');
  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles({ name: 'max.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: maxFile() });
  // no card account yet: only "create" fits (bank accounts aren't offered for a card file)
  await expect(page.getByTestId('import-ask-account')).toBeVisible();
  await expect(page.getByTestId('import-ask-select').locator('option')).toHaveCount(1);
  await page.getByTestId('import-new-name').fill('Max');
  await page.getByTestId('import-new-create').click();
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done-summary')).toHaveAttribute('data-inserted', '2');
  await page.goto('/accounts');
  await expect(page.getByTestId('account-card').filter({ hasText: 'Max' })).toHaveCount(1);
});

test('live card tracking: create a key (shown once), see the setup steps, revoke it', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings');
  const card = page.getByTestId('live-capture');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('live-url-purchase')).toContainText('/api/hook/purchase');
  await card.getByTestId('live-create').click();
  await expect(card.getByTestId('live-token')).toContainText('mz_');
  // the steps carry the new key
  await expect(card).toContainText(`Bearer ${(await card.getByTestId('live-token').textContent())!.trim()}`);
  await expectNoHorizontalOverflow(page);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/en/state-live-capture.png' });
  await card.getByTestId('live-revoke').first().click();
  await expect(card.getByTestId('live-keys')).toBeHidden();
});
