import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ensureAdmin, signIn } from './auth';
import { FIX, ensureAccountNamed } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));
const expected = JSON.parse(readFileSync(`${FIX}/expected.json`, 'utf8'));

async function choose(page: Page, file: string, account = 'Main checking') {
  await page.goto('/import');
  await page.getByTestId('import-account').selectOption({ label: account });
  await expect(page.getByTestId('import-file')).toBeEnabled();
    await page.getByTestId('import-file').setInputFiles(`${FIX}/${file}`);
}
const count = (page: Page, id: string) => page.getByTestId(`count-${id}`);

test('Otsar October file: preview → commit → ledger shows the rows', async ({ page }) => {
  await signIn(page, 'admin');
  await ensureAccountNamed(page, 'Main checking');
  await choose(page, 'otsar_2026-10.xlsx');
  const e = expected['otsar_2026-10.xlsx'];
  await expect(count(page, 'new')).toHaveAttribute('data-value', String(e.rows));
  await expect(count(page, 'duplicate')).toHaveAttribute('data-value', '0');
  await expect(count(page, 'error')).toHaveAttribute('data-value', '0');
  await expect(page.getByTestId('preview-rows').locator('li')).toHaveCount(e.rows);
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done-summary')).toHaveAttribute('data-inserted', String(e.rows));
  await page.getByTestId('import-view-ledger').click();
  await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-31/);
  await expect(page.getByTestId('ledger-summary').locator('[data-count]')).toHaveAttribute('data-count', String(e.rows));
});

test('re-importing the same file finds 0 new and N duplicates', async ({ page }) => {
  await signIn(page, 'admin');
  await choose(page, 'otsar_2026-10.xlsx');
  const e = expected['otsar_2026-10.xlsx'];
  await expect(count(page, 'new')).toHaveAttribute('data-value', '0');
  await expect(count(page, 'duplicate')).toHaveAttribute('data-value', String(e.rows));
  await expect(page.getByTestId('import-commit')).toBeDisabled();
});

test('an overlapping file imports only the new rows', async ({ page }) => {
  await signIn(page, 'admin');
  await choose(page, 'otsar_2026-10-15_2026-11-14.xlsx');
  const e = expected['otsar_2026-10-15_2026-11-14.xlsx'];
  await expect(count(page, 'new')).toHaveAttribute('data-value', String(e.newRowsAfterOctober));
  await expect(count(page, 'duplicate')).toHaveAttribute('data-value', String(e.rows - e.newRowsAfterOctober));
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done-summary')).toHaveAttribute('data-inserted', String(e.newRowsAfterOctober));
  await expect(page.getByTestId('import-row')).toHaveCount(2);
});

test('broken file: error report listed and downloadable', async ({ page }) => {
  await signIn(page, 'admin');
  await choose(page, 'broken.xlsx');
  await expect(count(page, 'error')).toHaveAttribute('data-value', '4');
  await expect(page.getByTestId('import-errors').locator('li')).toHaveCount(4);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-errors').click()]);
  const text = readFileSync((await dl.path())!, 'utf8');
  expect(text).toContain('date_invalid');
  expect(text.split('\n').filter(Boolean)).toHaveLength(5);
});

test('unsupported files are rejected before parsing', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/import');
  await expect(page.getByTestId('import-file')).toBeEnabled();
    await page.getByTestId('import-file').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByTestId('import-file-error')).toBeVisible();
});

test('generic windows-1255 CSV goes through the column mapper', async ({ page }) => {
  await signIn(page, 'admin');
  await ensureAccountNamed(page, 'Other bank');
  await choose(page, 'generic_bank.csv', 'Other bank');
  await expect(page.getByTestId('mapper')).toBeVisible();
  await expect(page.getByTestId('map-date')).toHaveValue('0');
  await expect(page.getByTestId('map-amount')).toHaveValue('2');
  await expect(page.getByTestId('map-preview').locator('li')).toHaveCount(5);
  await page.getByTestId('map-continue').click();
  const e = expected['generic_bank.csv'];
  await expect(count(page, 'new')).toHaveAttribute('data-value', String(e.rows));
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done-summary')).toHaveAttribute('data-inserted', String(e.rows));
  // the mapping is remembered for this account
  await choose(page, 'generic_bank.csv', 'Other bank');
  await expect(page.getByTestId('mapper')).toContainText(/saved|נשמרה/);
});

test('account picked from the bank list; a file without a known account asks which one', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/accounts');
  await page.getByTestId('account-card').filter({ hasText: 'Other bank' }).getByRole('button', { name: /Edit|עריכה/ }).click();
  await page.getByTestId('bank-leumi').click();
  await page.getByTestId('account-save').click();
  await expect(page.getByTestId('account-card').filter({ hasText: 'Other bank' }).getByTestId('bank-link')).toHaveAttribute('href', /leumi\.co\.il/);
  // no account pre-selected; the generic CSV names no account → the user is asked
  await page.goto('/import');
  await page.getByTestId('import-file').setInputFiles(`${FIX}/generic_bank.csv`);
  await expect(page.getByTestId('import-ask-account')).toBeVisible();
  await expect(page.getByTestId('import-ask-continue')).toBeDisabled();
  await page.getByTestId('import-ask-select').selectOption({ label: 'Other bank' });
  await page.getByTestId('import-ask-continue').click();
  await expect(page.getByTestId('mapper')).toContainText(/saved|נשמרה/);
});

test('undo an import removes its transactions', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/import');
  await expect(page.getByTestId('import-row').first()).toBeVisible();
  const before = await page.getByTestId('import-row').count();
  await page.getByTestId('import-undo').first().click();
  await page.getByTestId('undo-confirm-ok').click();
  await expect(page.getByTestId('import-row').first()).toContainText(/Undone|בוטל/);
  expect(await page.getByTestId('import-row').count()).toBe(before);
  // re-import it again so later specs have the data
  await choose(page, 'generic_bank.csv', 'Other bank');
  await page.getByTestId('map-continue').click();
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
});
