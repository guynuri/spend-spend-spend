import { expect, test } from '@playwright/test';
import { ensureAdmin, prepPage, registerVia, signIn } from './auth';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

test('owner invites a member and a viewer; they join the same household', async ({ page, browser }) => {
  await signIn(page, 'admin');
  await page.goto('/household');
  await page.getByTestId('invite-role').selectOption('member');
  await page.getByTestId('create-invite').click();
  const memberLink = (await page.getByTestId('invite-link').textContent())!;
  await page.getByTestId('invite-role').selectOption('viewer');
  await page.getByTestId('create-invite').click();
  await expect(page.getByTestId('invite-link')).not.toHaveText(memberLink);
  const viewerLink = (await page.getByTestId('invite-link').textContent())!;
  expect(memberLink).toContain('/invite#');
  expect(viewerLink).not.toBe(memberLink);

  for (const [link, who, name] of [[memberLink, 'member', 'Mira Member'], [viewerLink, 'viewer', 'Vered Viewer']] as const) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await prepPage(p);
    await registerVia(p, new URL(link).pathname + new URL(link).hash, name, who);
    await expect(p.getByTestId('household-name')).toHaveText(await page.getByTestId('household-name').textContent() ?? '');
    await ctx.close();
  }
  await page.reload();
  await expect(page.getByTestId('member-row')).toHaveCount(3);
});

test('viewer sees no write controls on household page', async ({ page }) => {
  await signIn(page, 'viewer');
  await page.goto('/household');
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.getByTestId('create-invite')).toHaveCount(0);
  await expect(page.getByTestId('member-role')).toHaveCount(0);
});

test('super-admin creates a second household; its owner sees an empty, separate household', async ({ page, browser }) => {
  await signIn(page, 'admin');
  await page.goto('/admin');
  await page.getByTestId('admin-household-name').fill('Second family');
  await page.getByTestId('admin-create-household').click();
  const link = (await page.getByTestId('admin-link').first().textContent())!;
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await prepPage(p);
  await registerVia(p, new URL(link).pathname + new URL(link).hash, 'Sara Second', 'owner2');
  await expect(p.getByTestId('household-name')).toHaveText('Second family');
  // empty household: onboarding, none of the first household's data
  await expect(p.getByTestId('onboarding')).toBeVisible();
  const tx = await p.request.get('/api/transactions?from=2000-01-01&to=2100-01-01');
  expect((await tx.json()).summary.count).toBe(0);
  await p.goto('/household');
  await expect(p.getByTestId('member-row')).toHaveCount(1);
  // sample data fills every page; the banner offers to clear it (AC14.1)
  await p.goto('/');
  await p.getByTestId('onboarding-sample').click();
  await expect(p.getByTestId('sample-banner')).toBeVisible();
  await expect(p.getByTestId('forecast-card')).toBeVisible();
  for (const r of ['/transactions', '/budget', '/upcoming', '/recurring', '/goals', '/trends']) {
    await p.goto(r);
    await expect(p.getByTestId('app-root')).toBeVisible();
    await expect(p.getByTestId('sample-banner')).toBeVisible();
  }
  await p.getByTestId('sample-clear').click();
  await p.getByTestId('sample-clear-confirm-ok').click();
  await expect(p.getByTestId('sample-banner')).toBeHidden();
  await p.goto('/');
  await expect(p.getByTestId('onboarding')).toBeVisible();
  await ctx.close();
});

test('typed confirmation never carries over between reset and delete (review fix)', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/household');
  const name = (await page.getByTestId('household-name').textContent())!;
  await page.getByTestId('data-reset').click();
  await page.getByTestId('data-confirm-input').fill(name);
  await expect(page.getByTestId('data-confirm-ok')).toBeEnabled();
  await page.getByTestId('data-confirm').getByRole('button', { name: /cancel|ביטול/i }).click();
  await page.getByTestId('data-delete').click();
  await expect(page.getByTestId('data-confirm-input')).toHaveValue('');
  await expect(page.getByTestId('data-confirm-ok')).toBeDisabled();
  await page.getByTestId('data-confirm').getByRole('button', { name: /cancel|ביטול/i }).click();
});
