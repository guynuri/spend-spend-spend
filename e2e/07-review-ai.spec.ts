import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

const CHAPTERS = ['summary', 'income', 'spending', 'budget', 'goals', 'cashflow', 'wrapup'];

test('AI disabled: all 7 chapters render; complete the review; it appears in history', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/review');
  await page.getByTestId('review-start').click();
  for (const [i, ch] of CHAPTERS.entries()) {
    await expect(page.getByTestId(`chapter-${ch}`)).toBeVisible();
    if (ch !== 'wrapup') await expect(page.getByTestId(`chapter-${ch}`).getByTestId('chapter-commentary').first()).not.toBeEmpty();
    if (i < CHAPTERS.length - 1) await page.getByTestId('review-next').click();
  }
  await expect(page.getByTestId('review-headline')).not.toBeEmpty();
  await page.getByTestId('review-back').click();
  await expect(page.getByTestId('chapter-cashflow')).toBeVisible();
  await page.getByTestId('review-skip').click();
  await page.getByTestId('review-complete').click();
  await expect(page.getByTestId('review-flow')).toHaveAttribute('data-status', 'completed');
  await page.goto('/review');
  await expect(page.getByTestId('review-history-item')).toHaveCount(1);
  await page.getByTestId('review-history-item').first().click();
  await expect(page.getByTestId('chapter-summary')).toBeVisible();
  await expect(page.getByTestId('review-flow')).toHaveAttribute('data-status', 'completed');
});
