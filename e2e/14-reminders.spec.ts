// Reminders: Settings CRUD at phone width (he + en) and the in-app card with its click targets.
// Push delivery itself can't be exercised here (needs a real push service + OS notification centre);
// the e2e server runs without VAPID keys, so Settings shows the in-app-only notice.
import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { ensureAdmin, signIn } from './auth';
import { ensureAccountNamed, expectNoHorizontalOverflow } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

/** Writes straight into the e2e server's local D1 (same persist dir as scripts/e2e-server.mjs). */
function sql(command: string) {
  execSync(`npx wrangler d1 execute maazan --local --persist-to .wrangler/e2e --command "${command}"`, { stdio: 'pipe', env: { ...process.env, CI: '1' } });
}
const rows = (page: Page) => page.getByTestId('reminder-row');

for (const locale of ['en', 'he'] as const) {
  test(`create, toggle and delete reminders in Settings (${locale})`, async ({ page }) => {
    await signIn(page, 'admin', locale);
    await ensureAccountNamed(page, 'Main checking');
    await page.goto('/settings');
    const card = page.getByTestId('reminders-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('push-unavailable')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const before = await rows(page).count();

    // monthly import on the 31st at 08:00 for an account
    await card.getByTestId('reminder-new').click();
    await card.getByTestId('rem-mday').selectOption('31');
    await card.getByTestId('rem-hour').selectOption('8');
    await card.getByTestId('rem-account').selectOption({ label: 'Main checking' });
    await card.getByTestId('rem-save').click();
    await expect(rows(page)).toHaveCount(before + 1);
    await expect(rows(page).last()).toContainText('08:00');

    // daily at 20:00, weekdays only (Fri + Sat off)
    await card.getByTestId('reminder-new').click();
    await card.getByTestId('rem-kind').selectOption('daily');
    await card.getByTestId('rem-day-5').click();
    await card.getByTestId('rem-day-6').click();
    await card.getByTestId('rem-save').click();
    await expect(rows(page)).toHaveCount(before + 2);
    await expectNoHorizontalOverflow(page);

    const last = rows(page).last();
    await last.getByTestId('reminder-toggle').click();
    await expect(last.getByTestId('reminder-toggle')).not.toBeChecked();
    await page.reload();
    await expect(rows(page).last().getByTestId('reminder-toggle')).not.toBeChecked();
    await rows(page).last().getByTestId('reminder-toggle').click();
    await expect(rows(page).last().getByTestId('reminder-toggle')).toBeChecked();

    for (let i = 0; i < 2; i++) {
      const n = await rows(page).count();
      await rows(page).last().getByTestId('reminder-delete').click();
      await expect(rows(page)).toHaveCount(n - 1);
    }
    await expectNoHorizontalOverflow(page);
  });
}

test('a due reminder shows on Overview and its links land in the right place', async ({ page }) => {
  await page.context().route('https://www.leumi.co.il/**', (r) => r.fulfill({ body: 'bank', contentType: 'text/html' }));
  await signIn(page, 'admin');
  await ensureAccountNamed(page, 'Reminder bank');
  sql("UPDATE accounts SET bank_id = 'leumi' WHERE name = 'Reminder bank'");
  await page.goto('/settings');
  const card = page.getByTestId('reminders-card');
  await expect(card).toBeVisible();
  await card.getByTestId('reminder-new').click();
  await card.getByTestId('rem-kind').selectOption('daily');
  await card.getByTestId('rem-save').click();
  await expect(card.getByTestId('reminder-new')).toBeVisible();
  await card.getByTestId('reminder-new').click();
  await card.getByTestId('rem-account').selectOption({ label: 'Reminder bank' });
  await card.getByTestId('rem-save').click();
  await expect(card.getByTestId('reminder-new')).toBeVisible();
  // pretend both were last seen long ago
  sql("UPDATE reminders SET seen_at = '2000-01-01T00:00:00.000Z', last_sent_at = '2000-01-01T00:00:00.000Z'");

  await page.goto('/');
  const cards = page.getByTestId('reminder-card');
  await expect(cards).toHaveCount(2);
  await expectNoHorizontalOverflow(page);

  // daily → the add-transaction sheet opens
  await cards.first().getByTestId('reminder-card-open').click();
  await expect(page.getByTestId('add-tx')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/$/);
  await expect(cards).toHaveCount(1);

  // import with a catalog bank → bank site in a new tab, app on Import with the account picked
  const [popup] = await Promise.all([page.waitForEvent('popup'), cards.first().getByTestId('reminder-card-open').click()]);
  await popup.waitForURL(/leumi\.co\.il/);
  await popup.close();
  await expect(page).toHaveURL(/\/import\?account=/);
  const accId = new URL(page.url()).searchParams.get('account')!;
  await expect(page.getByTestId('import-account')).toHaveValue(accId);

  // the notification target: prominent "open bank website" button
  await page.goto(`/import?account=${accId}&openBank=1`);
  await expect(page.getByTestId('import-open-bank')).toHaveAttribute('href', 'https://www.leumi.co.il/');
  await page.goto('/');
  await expect(page.getByTestId('reminder-card')).toHaveCount(0);

  // clean up for later specs
  sql('DELETE FROM reminders');
});

test('pay day: the month runs from pay day to pay day on Budget and Transactions', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings');
  const card = page.getByTestId('payday-card');
  await card.getByTestId('payday-day').selectOption('10');
  await expect(card.getByTestId('payday-example')).toContainText('10');
  await card.getByTestId('payday-save').click();
  await page.goto('/budget');
  await expect(page.getByTestId('budget-month').getByTestId('period-label')).toContainText(/10 .* – 9 /);
  await page.goto('/transactions');
  await expect(page.getByTestId('ledger-range')).toContainText(/10 .* – 9 /);
  // back to calendar months for the other specs
  await page.goto('/settings');
  await page.getByTestId('payday-card').getByTestId('payday-day').selectOption('1');
  await page.getByTestId('payday-card').getByTestId('payday-save').click();
  await expect(page.getByTestId('payday-card').getByTestId('payday-save')).toBeDisabled();
});
