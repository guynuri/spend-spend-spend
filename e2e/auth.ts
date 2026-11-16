import { expect, type Browser, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const STATE = 'e2e/.state';
export interface Cred {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

export async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return {
    async credentials(): Promise<Cred[]> {
      return (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials as Cred[];
    },
    async add(c: Cred) {
      await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: c });
    },
  };
}

export function saveCred(who: string, cred: Cred) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(`${STATE}/${who}.json`, JSON.stringify(cred));
}
export function loadCred(who: string): Cred | null {
  const f = `${STATE}/${who}.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Cred) : null;
}
export function saveValue(name: string, v: unknown) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(`${STATE}/${name}.value.json`, JSON.stringify(v));
}
export function loadValue<T>(name: string): T | null {
  const f = `${STATE}/${name}.value.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

export async function prepPage(page: Page, locale: 'en' | 'he' = 'en') {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem('mz_locale', l);
      localStorage.setItem('mz_hint_install', '1');
      localStorage.setItem('mz_tour_done', '1');
    } catch {
      /* ignore */
    }
  }, locale);
}

/** Registers through a token page (setup / invite / recover) with a fresh authenticator. */
export async function registerVia(page: Page, url: string, displayName: string | null, who: string) {
  const auth = await addAuthenticator(page);
  await page.goto(url);
  const ready = page.getByTestId('create-passkey').or(page.getByTestId('link-invalid'));
  await expect(ready).toBeVisible();
  if (await page.getByTestId('link-invalid').isVisible()) throw new Error(`invite link rejected: ${await page.getByTestId('link-invalid').textContent()}`);
  if (displayName !== null) await page.getByTestId('display-name').fill(displayName);
  await page.getByTestId('create-passkey').click();
  await expect(page.getByTestId('app-root').or(page.getByTestId('auth-layout').getByRole('heading'))).toBeVisible();
  await page.waitForURL((u) => !/\/(setup|invite|recover)$/.test(u.pathname));
  const creds = await auth.credentials();
  saveCred(who, creds[creds.length - 1]!);
}

/** Bootstraps the super-admin once per e2e run. */
export async function ensureAdmin(browser: Browser) {
  if (loadCred('admin')) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await prepPage(page);
  await registerVia(page, '/setup#e2e-bootstrap', 'Avi Admin', 'admin');
  await ctx.close();
}

/** Passkey sign-in as a saved user in this page's context. */
export async function signIn(page: Page, who: string, locale: 'en' | 'he' = 'en', next = '/') {
  const cred = loadCred(who);
  if (!cred) throw new Error(`no saved credential for ${who}`);
  await prepPage(page, locale);
  const auth = await addAuthenticator(page);
  await auth.add(cred);
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByTestId('signin-button').click();
  await expect(page.getByTestId('app-root')).toBeVisible();
  await persistCred(auth, who);
  // The profile's language wins once /api/me is applied, so decide from the profile, not the current <html lang>.
  const me = (await (await page.request.get('/api/me')).json()) as { user: { locale: string | null } };
  if (me.user.locale && me.user.locale !== locale) {
    await setUiLocale(page, locale);
    await page.goto(next);
  }
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}

/** Saves the authenticator's credential again so the next sign-in continues the sign counter. */
export async function persistCred(auth: Awaited<ReturnType<typeof addAuthenticator>>, who: string) {
  const creds = await auth.credentials();
  if (creds[0]) saveCred(who, creds[0]);
}

/** Switches the UI language through Settings (persists to the profile, which wins over localStorage). */
export async function setUiLocale(page: Page, locale: 'en' | 'he') {
  await page.goto('/settings');
  await page.getByTestId('locale-switch').getByRole('radio').nth(locale === 'en' ? 0 : 1).click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}
