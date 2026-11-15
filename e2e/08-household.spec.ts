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
  await p.goto('/household');
  await expect(p.getByTestId('member-row')).toHaveCount(1);
  await ctx.close();
});
