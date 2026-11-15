import { expect, test } from '@playwright/test';
import { ensureAdmin, signIn, prepPage, addAuthenticator, loadCred, persistCred } from './auth';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));

test('sign out, passkey sign-in, session persists on reload', async ({ page, context }) => {
  await signIn(page, 'admin');
  await page.reload();
  await expect(page.getByTestId('tabbar')).toBeVisible();
  const cookies = await context.cookies();
  const c = cookies.find((x) => x.name === '__Host-mz_session')!;
  expect(c.httpOnly).toBe(true);
  expect(c.secure).toBe(true);
  expect(c.sameSite).toBe('Lax');
  await page.goto('/household');
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/signin/);
  await page.goto('/budget');
  await expect(page).toHaveURL(/\/signin\?next=%2Fbudget/);
});

test('unauthenticated deep link redirects to sign-in and back', async ({ page }) => {
  await prepPage(page);
  const auth = await addAuthenticator(page);
  await auth.add(loadCred('admin')!);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/signin\?next=%2Fsettings/);
  await page.getByTestId('signin-button').click();
  await expect(page).toHaveURL(/\/settings$/);
  await persistCred(auth, 'admin');
});
