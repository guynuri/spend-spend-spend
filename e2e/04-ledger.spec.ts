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

/** Nothing in the open sheet sticks out sideways (phone width) and it does not scroll horizontally. */
async function expectSheetFits(page: Page, testId = 'tx-sheet') {
  const r = await page.getByTestId(testId).evaluate((el) => {
    const w = window.innerWidth;
    const out = [...el.querySelectorAll('*')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && (b.right > w + 0.5 || b.left < -0.5);
    });
    const sc = el.querySelector('.overflow-y-auto')!;
    return { out: out.map((e) => e.tagName), sw: sc.scrollWidth, cw: sc.clientWidth };
  });
  expect(r.out, 'elements outside the screen').toEqual([]);
  expect(r.sw).toBeLessThanOrEqual(r.cw);
}

async function addTx(page: Page, amount: string, description: string) {
  await page.getByTestId('ledger-add').click();
  await page.getByTestId('add-amount').fill(amount);
  await page.getByTestId('add-description').fill(description);
  await page.getByTestId('add-tx-save').click();
  await expect(page.getByTestId('add-tx')).toBeHidden();
}

test('add manual transactions; categorizing one changes only it, "always" learns and categorizes the rest', async ({ page }) => {
  await signIn(page, 'admin');
  await ensureAccount(page);
  await page.goto('/transactions');
  for (const a of ['42.50', '38', '51.20']) await addTx(page, a, 'Cafe Roma E2E');
  const rows = page.getByTestId('tx-row').filter({ hasText: 'Cafe Roma E2E' });
  await expect(rows).toHaveCount(3);
  await rows.first().click();
  const sheet = page.getByTestId('tx-sheet');
  await sheet.getByTestId('tx-category').selectOption({ label: 'Eating out' });
  // Only this one changed; the 2 similar ones are offered, not changed.
  await expect(sheet.getByTestId('tx-similar')).toContainText('2 more uncategorized');
  await expect(page.getByTestId('toast').filter({ hasText: /more categorized/ })).toHaveCount(0);
  await sheet.getByTestId('tx-similar-always').click();
  await expect(page.getByTestId('toast').filter({ hasText: /2 more categorized/ })).toBeVisible();
  await expect(sheet.getByTestId('tx-similar')).toBeHidden();
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
  await page.getByTestId('tx-similar-always').click();
  await page.getByTestId('toast').filter({ hasText: /1 more categorized/ }).getByTestId('toast-action').click();
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
  await expectSheetFits(page);
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

test('applying to similar is a one-off; payment-app transfers are never offered', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions?q=e2e+once');
  for (const a of ['7', '8']) await addTx(page, a, 'Bakery E2E once');
  await page.getByTestId('tx-row').first().click();
  const sheet = page.getByTestId('tx-sheet');
  await sheet.getByTestId('tx-category').selectOption({ label: 'Eating out' });
  await sheet.getByTestId('tx-similar-apply').click();
  await expect(page.getByTestId('toast').filter({ hasText: /1 transaction updated/ })).toBeVisible();
  await closeSheet(page, 'tx-sheet');
  await addTx(page, '9', 'Bakery E2E once');
  await page.goto('/transactions?q=e2e+once&uncategorized=1');
  await expect(page.getByTestId('tx-row')).toHaveCount(1); // no rule was learned
  await page.goto('/transactions?q=bit+e2e');
  for (const a of ['20', '30']) await addTx(page, a, 'BIT E2E transfer');
  await page.getByTestId('tx-row').first().click();
  await sheet.getByTestId('tx-category').selectOption({ label: 'Eating out' });
  await expect(sheet.getByText('by you')).toBeVisible();
  await expect(sheet.getByTestId('tx-similar')).toHaveCount(0);
});

test('search matches category names', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions?q=bulk+e2e');
  const cat = await page.getByTestId('tx-row').first().locator('span.truncate').innerText();
  await page.getByTestId('ledger-search').fill(cat);
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Bulk E2E' })).toHaveCount(2);
});

test('needs-attention card: filter to uncategorized, dismiss, reappears on new items', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions');
  await page.evaluate(() => localStorage.removeItem('mz_todo_dismissed'));
  await addTx(page, '3', 'Todo E2E one');
  const card = page.getByTestId('todo-card');
  await expect(card.getByTestId('todo-uncat')).toBeVisible();
  await card.getByTestId('todo-uncat-show').click();
  await expect(page).toHaveURL(/uncategorized=1/);
  await card.getByTestId('todo-dismiss').click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('tx-row').first()).toBeVisible();
  await expect(card).toBeHidden();
  await addTx(page, '4', 'Todo E2E two');
  await expect(card.getByTestId('todo-uncat')).toBeVisible();
});

test('split a card payment from an uploaded card statement; keep the difference unassigned (Hebrew)', async ({ page }) => {
  await signIn(page, 'admin', 'he');
  await page.goto('/transactions?q=e2e+statement');
  await addTx(page, '1000', 'ISRACARD E2E statement');
  await page.getByTestId('tx-row').first().click();
  await page.getByTestId('tx-split').click();
  // Isracard layout: recognized by the card parser (parseCardStatement), not the generic guess.
  const csv = 'תאריך רכישה,שם בית עסק,סכום חיוב\n01/11/2026,שופרסל דיל 123,400.00\n02/11/2026,קפה E2E אחד,350.00\n03/11/2026,קפה E2E שני,200.00\n04/11/2026,זיכוי E2E,-50.00\n99/99/2026,שורה שבורה,10.00\n';
  await page.getByTestId('split-file').setInputFiles({ name: 'card.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(page.getByTestId('split-loaded')).toContainText('4');
  await expect(page.getByTestId('split-loaded')).toHaveAttribute('data-card', 'true');
  await expect(page.getByTestId('split-skipped')).toBeVisible(); // the broken row is reported, not dropped silently
  const lines = page.getByTestId('split-line');
  await expect(lines).toHaveCount(4);
  await expect(lines.nth(3).locator('input')).toHaveValue('-50.00'); // refund keeps its sign
  await expect(lines.nth(0).locator('select')).not.toHaveValue(''); // שופרסל → seed rule
  await expect(lines.nth(1)).toContainText('קפה E2E אחד');
  await expect(page.getByTestId('split-save')).toBeDisabled();
  await expectSheetFits(page);
  await page.getByTestId('split-keep-remainder').click();
  await expect(lines).toHaveCount(5);
  await expect(page.getByTestId('split-remaining')).toHaveAttribute('class', /text-good/);
  await expectSheetFits(page);
  await page.getByTestId('split-save').click();
  await expect(page.getByTestId('tx-sheet')).toBeHidden();
  await expect(page.getByTestId('tx-row').first().getByText(/^(Split|מפוצל)$/)).toBeVisible();
  // Reopening keeps the refund negative, so the saved split still adds up.
  await page.getByTestId('tx-row').first().click();
  await page.getByTestId('tx-split').click();
  await expect(page.getByTestId('split-line').nth(3).locator('input')).toHaveValue('-50.00');
  await expect(page.getByTestId('split-save')).toBeEnabled();
});

test('split from a card statement PDF: grouped businesses, AI fills the rest, rules are learned (Hebrew)', async ({ page }) => {
  await signIn(page, 'admin', 'he');
  await page.goto('/transactions?q=e2e+pdf');
  const H = { 'x-mz': '1', origin: new URL(page.url()).origin };
  await addTx(page, '2312.10', 'ISRACARD e2e pdf');
  expect((await page.request.post('/api/ai/consent', { headers: H, data: { enabled: true } })).ok()).toBe(true);
  try {
    await page.getByTestId('tx-row').first().click();
    await page.getByTestId('tx-split').click();
    // Synthetic statement (scripts/gen-card-pdf.mjs): read in the browser with pdf.js.
    await page.getByTestId('split-file').setInputFiles('fixtures/isracard/synthetic/statement.pdf');
    await expect(page.getByTestId('split-loaded')).toContainText('11');
    await expect(page.getByTestId('split-total-mismatch')).toHaveCount(0);
    const lines = page.getByTestId('split-line');
    // The bakery's two charges are one line; PayPal (a payment app) keeps one line per charge.
    const bakery = lines.filter({ hasText: 'מאפיית השקד' });
    await expect(bakery).toHaveCount(1);
    await expect(bakery.getByTestId('split-line-count')).toContainText('2');
    await expect(lines.filter({ hasText: 'TOURSHOP' })).toHaveCount(2);
    await expect(page.getByTestId('split-ai')).toBeVisible();
    await expect(page.getByTestId('split-remaining')).toHaveAttribute('class', /text-good/);
    await expectSheetFits(page);
    await expect(page.getByTestId('split-learn')).toBeChecked();
    await page.getByTestId('split-save').click();
    await expect(page.getByTestId('tx-sheet')).toBeHidden();
    // Next month the café is categorized by the learned rule.
    const m = await page.request.post('/api/rules/match', { headers: H, data: { items: [{ description: 'קפה לימון', amountMinor: -1000 }] } });
    expect(((await m.json()) as { categoryIds: (string | null)[] }).categoryIds[0]).not.toBeNull();
  } finally {
    await page.request.post('/api/ai/consent', { headers: H, data: { enabled: false } });
  }
});

test('a card PDF reads in a browser without async-iterable streams (iPhone Safari)', async ({ page }) => {
  // Safari has no ReadableStream[Symbol.asyncIterator]; pdf.js's getTextContent needs it.
  await page.addInitScript(() => {
    delete (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator];
  });
  await signIn(page, 'admin');
  await ensureAccount(page);
  await page.goto('/transactions?q=e2e+safari+pdf');
  await addTx(page, '2312.10', 'ISRACARD e2e safari pdf');
  await page.getByTestId('tx-row').first().click();
  await page.getByTestId('tx-split').click();
  await page.getByTestId('split-file').setInputFiles('fixtures/isracard/synthetic/statement.pdf');
  await expect(page.getByTestId('split-loaded')).toContainText('11');
  await expect(page.getByTestId('split-remaining')).toHaveAttribute('class', /text-good/);
});

test('investment / trading account: picker defaults it out of forecast and cushion, shows the hint', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/accounts');
  await page.getByTestId('account-add').click();
  await page.getByTestId('account-name').fill('Trading');
  await expect(page.getByTestId('account-forecast')).toBeChecked();
  await page.getByTestId('account-type').selectOption('investment');
  await expect(page.getByTestId('investment-hint')).toBeVisible();
  await expect(page.getByTestId('account-forecast')).not.toBeChecked();
  await expect(page.getByTestId('account-liquid')).not.toBeChecked();
  await expectSheetFits(page, 'account-sheet');
  await page.getByTestId('account-save').click();
  const card = page.getByTestId('account-card').filter({ hasText: 'Trading' });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(/Investment \/ trading|השקעות \/ מסחר/);
  // Converting an existing account applies the defaults; switching away keeps manual choices.
  await ensureAccount(page);
  await page.getByTestId('account-card').filter({ hasText: 'Main checking' }).getByRole('button', { name: /edit|עריכה/i }).click();
  await expect(page.getByTestId('account-liquid')).toBeChecked();
  await page.getByTestId('account-type').selectOption('investment');
  await expect(page.getByTestId('account-liquid')).not.toBeChecked();
  await page.getByTestId('account-liquid').check();
  await page.getByTestId('account-type').selectOption('savings');
  await expect(page.getByTestId('account-liquid')).toBeChecked();
  await closeSheet(page, 'account-sheet');
});

test.describe('without the service worker', () => {
  // page.route can't see requests a service worker answers from its cache.
  test.use({ serviceWorkers: 'block' });
  test('a PDF that cannot be read says why (both pdf.js builds tried)', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/transactions?q=e2e+pdf+fail');
  await addTx(page, '100', 'ISRACARD e2e pdf fail');
  await page.getByTestId('tx-row').first().click();
  await page.getByTestId('tx-split').click();
  // Simulate a browser where pdf.js can't load (e.g. a device-specific failure).
  await page.route(/\/assets\/pdf(\.worker\.min)?-[^/]*\.m?js$/, (r) => r.abort());
  await page.getByTestId('split-file').setInputFiles('fixtures/isracard/synthetic/statement.pdf');
  const detail = page.getByTestId('split-error-detail');
  await expect(detail).toContainText('modern:');
  await expect(detail).toContainText('legacy:');
});
});
