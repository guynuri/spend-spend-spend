import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

const CHAPTERS = ['summary', 'income', 'spending', 'budget', 'goals', 'cashflow', 'wrapup'];

test('AI disabled: all 7 chapters render; complete the review; it appears in history', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/review');
  await page.getByTestId('review-start').click();
  await expect(page.getByTestId('ai-enable-hint')).toBeVisible();
  await expect(page.getByTestId('ai-write')).toHaveCount(0);
  for (const [i, ch] of CHAPTERS.entries()) {
    await expect(page.getByTestId(`chapter-${ch}`)).toBeVisible();
    if (ch !== 'wrapup') await expect(page.getByTestId(`chapter-${ch}`).getByTestId('chapter-commentary').first()).not.toBeEmpty();
    if (i < CHAPTERS.length - 1) await page.getByTestId('review-next').click();
  }
  await expect(page.getByTestId('review-headline')).not.toBeEmpty();
  // final summary: verdict stats, wins, focus areas, numbered actions, then a clear complete button
  await expect(page.getByTestId('review-final')).toBeVisible();
  await expect(page.getByTestId('review-actions').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('review-complete')).toBeVisible();
  await page.getByTestId('review-back').click();
  await expect(page.getByTestId('chapter-cashflow')).toBeVisible();
  await page.getByTestId('review-skip').click();
  await page.getByTestId('review-complete').click();
  await expect(page.getByTestId('review-flow')).toHaveAttribute('data-status', 'completed');
  await expect(page.getByTestId('review-completed-note')).toBeVisible();
  await page.goto('/review');
  await expect(page.getByTestId('review-history-item')).toHaveCount(1);
  await page.getByTestId('review-history-item').first().click();
  await expect(page.getByTestId('chapter-summary')).toBeVisible();
  await expect(page.getByTestId('review-flow')).toHaveAttribute('data-status', 'completed');
});

test('enable AI through the consent sheet, write commentary (mock), disable again', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/settings');
  await page.getByTestId('ai-enable').click();
  const sheet = page.getByTestId('ai-consent');
  await expect(sheet.getByTestId('ai-consent-provider')).toContainText('Mock');
  await expect(sheet.getByTestId('ai-consent-model')).not.toBeEmpty();
  await expect(sheet.getByTestId('ai-consent-sent').locator('li')).toHaveCount(4);
  await expect(sheet.getByTestId('ai-consent-trains')).toContainText(/not used for training/);
  await expect(sheet.getByTestId('ai-consent-limits')).toContainText('10');
  await page.getByTestId('ai-consent-ok').click();
  await expect(page.getByTestId('ai-disable')).toBeVisible();

  await page.goto('/review?month=2026-09&step=0');
  await expect(page.getByTestId('ai-interpretation')).toHaveCount(0);
  await page.getByTestId('ai-write').click();
  // the interpretation shows up as its own labelled block, scrolled into view; rule-based text stays
  const block = page.getByTestId('ai-interpretation');
  await expect(block).toBeInViewport();
  await expect(block.getByTestId('ai-text')).toContainText('AI note on summary');
  await expect(block.getByTestId('ai-written')).toBeVisible();
  await expect(page.getByTestId('chapter-commentary').first()).not.toContainText('AI note');
  await expect(page.getByTestId('ai-write')).toContainText('again');
  await page.reload();
  await expect(page.getByTestId('ai-text')).toContainText('AI note on summary'); // persisted with the review
  await page.getByTestId('review-skip').click();
  await expect(page.getByTestId('ai-headline')).toContainText('AI headline');

  await page.goto('/settings');
  await page.getByTestId('ai-disable').click();
  await expect(page.getByTestId('ai-enable')).toBeVisible();
  await page.goto('/review?month=2026-08&step=0');
  await expect(page.getByTestId('ai-enable-hint')).toBeVisible();
  await expect(page.getByTestId('ai-write')).toHaveCount(0);
});
