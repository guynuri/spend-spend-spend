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
  // the key's line says what its last request came to: never used, a hand-run test, then an unreadable purchase
  const token = (await card.getByTestId('live-token').textContent())!.trim();
  await expect(card.getByTestId('live-keys')).toContainText('Not used yet');
  const send = (body: string) => page.request.post('/api/hook/purchase', { headers: { authorization: `Bearer ${token}` }, data: body });
  const test = await send('');
  expect((await test.json()).message).toContain('Connected');
  await page.reload();
  await expect(card.getByTestId('live-key-status')).toHaveAttribute('data-result', 'test');
  await expect(card.getByTestId('live-key-status')).toContainText('connection test');
  expect((await send('nothing useful')).status()).toBe(400);
  await page.reload();
  await expect(card.getByTestId('live-key-status')).toHaveAttribute('data-result', 'unreadable_purchase');
  await expect(card.getByTestId('live-key-status')).toContainText('Received:');
  await expectNoHorizontalOverflow(page);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/en/state-live-capture.png' });
  await card.getByTestId('live-revoke').first().click();
  await expect(card.getByTestId('live-keys')).toBeHidden();
});

test('owner publishes the shared shortcut: one-tap install first, the manual steps behind "Didn\'t work?"', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings');
  const setup = page.getByTestId('live-setup-purchase');
  // no link yet: the manual steps are shown, and the owner can publish a link
  await expect(page.getByTestId('live-install-purchase')).toHaveCount(0);
  await setup.getByTestId('live-publish-purchase').locator('summary').click();
  await setup.getByTestId('live-link-input-purchase').fill('https://example.com/not-a-shortcut');
  await expect(setup.getByTestId('live-link-save-purchase')).toBeDisabled();
  const link = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
  await setup.getByTestId('live-link-input-purchase').fill(link);
  await setup.getByTestId('live-link-save-purchase').click();
  // now: install button + the few automation steps; the full steps are collapsed
  await expect(page.getByTestId('live-install-purchase')).toHaveAttribute('href', link);
  await expect(page.getByTestId('live-quick-purchase')).toContainText('Run Shortcut');
  // run it by hand once first, so iOS asks for its permissions (an automation can't); and what to do if it fails
  await expect(page.getByTestId('live-quick-purchase')).toContainText('Always Allow');
  await expect(page.getByTestId('live-trouble')).toContainText('There was a problem with the automation');
  const manual = page.getByTestId('live-manual-purchase');
  await expect(manual.getByText('Get Contents of URL').first()).toBeHidden();
  await manual.locator('summary').click();
  await expect(manual.getByText('Get Contents of URL').first()).toBeVisible();
  await manual.locator('summary').click();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('live-quick-purchase').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/en/state-live-quick.png' });
  // remove it again (other specs see the default state)
  const publish = setup.getByTestId('live-publish-purchase');
  if (!(await publish.evaluate((d) => (d as HTMLDetailsElement).open))) await publish.locator('summary').click();
  await setup.getByTestId('live-link-remove-purchase').click();
  await expect(page.getByTestId('live-install-purchase')).toHaveCount(0);
});
