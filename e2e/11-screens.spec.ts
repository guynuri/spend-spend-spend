/** Screenshots of interactive states in both locales, for visual review (PLAN §15.4 spec 9). */
import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';
import { FIX, expectNoHorizontalOverflow } from './helpers';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));

for (const locale of ['en', 'he'] as const) {
  test(`interactive states in ${locale}`, async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin', locale);
    const shot = async (name: string) => {
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${locale}/state-${name}.png`, fullPage: false });
    };
    await page.goto('/import');
    await page.getByTestId('import-file').setInputFiles(`${FIX}/otsar_2026-10.xlsx`);
    await expect(page.getByTestId('import-ask-account')).toBeVisible();
    await shot('import-ask-account');
    await page.goto('/import');
    await page.getByTestId('import-account').selectOption({ index: 1 });
    await expect(page.getByTestId('import-file')).toBeEnabled();
    await page.getByTestId('import-file').setInputFiles(`${FIX}/otsar_2026-10.xlsx`);
    await expect(page.getByTestId('import-preview')).toBeVisible();
    await shot('import-preview');
    await page.goto('/import');
    await page.getByTestId('import-account').selectOption({ index: 2 });
    await expect(page.getByTestId('import-file')).toBeEnabled();
    await page.getByTestId('import-file').setInputFiles(`${FIX}/generic_bank.csv`);
    await expect(page.getByTestId('mapper')).toBeVisible();
    await shot('import-mapper');
    await page.goto('/transactions?from=2026-10-01&to=2026-10-31');
    await page.getByTestId('tx-row').first().click();
    await expect(page.getByTestId('tx-sheet')).toBeVisible();
    await shot('tx-sheet');
    await page.getByTestId('tx-split').click();
    await expect(page.getByTestId('split-editor')).toBeVisible();
    await shot('split-editor');
  });
}
