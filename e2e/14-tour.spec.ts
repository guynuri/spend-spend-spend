import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { ensureAdmin, prepPage, registerVia, setUiLocale, signIn } from './auth';
import { expectNoHorizontalOverflow } from './helpers';
import { TOUR_STEPS } from '../src/client/lib/tour';

test.beforeAll(async ({ browser }) => ensureAdmin(browser));

/** A brand-new household with no data, its owner signed in on a phone-sized page in `locale`. */
async function freshOwner(page: Page, browser: Browser, locale: 'en' | 'he') {
  await signIn(page, 'admin');
  await page.goto('/admin');
  await page.getByTestId('admin-household-name').fill(`Tour ${locale}`);
  await page.getByTestId('admin-create-household').click();
  const link = new URL((await page.getByTestId('admin-link').first().textContent())!);
  const { defaultBrowserType: _, ...iphone } = devices['iPhone 15'];
  const ctx = await browser.newContext({ ...iphone, baseURL: new URL(page.url()).origin });
  const p = await ctx.newPage();
  await prepPage(p, locale);
  await registerVia(p, link.pathname + link.hash, 'Tami Tour', `tour-${locale}`);
  await setUiLocale(p, locale);
  await p.goto('/');
  return { p, ctx };
}

type Box = { x: number; y: number; width: number; height: number };
const inside = (b: Box, vp: { width: number; height: number }) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const locale of ['en', 'he'] as const) {
  test(`tour runs end to end on demo data for an empty household (${locale})`, async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { p, ctx } = await freshOwner(page, browser, locale);
    await expect(p.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
    await expect(p.getByTestId('onboarding')).toBeVisible();
    await p.getByTestId('onboarding-tour').click();

    const total = TOUR_STEPS.length; // an owner sees every step: none may be skipped
    const vp = p.viewportSize()!;
    const pop = p.getByTestId('tour-popover');
    for (let k = 1; k <= total; k++) {
      const step = TOUR_STEPS[k - 1]!;
      await expect(p.getByTestId('tour-progress')).toHaveText(`${k}/${total}`, { timeout: 15_000 });
      await expect(pop).toHaveAttribute('data-step', step.id);
      await expect(p.getByTestId('demo-badge')).toBeVisible();
      await expect(pop).toBeVisible();
      if (step.target) {
        await expect(p.locator(`[data-tour~="${step.target}"]`).first()).toBeAttached();
        // the ringed hole (target + 6 px) is on screen and the popover never covers it
        await expect
          .poll(async () => {
            const [h, q] = [await p.getByTestId('tour-hole').boundingBox(), await pop.boundingBox()];
            const t = h && { x: h.x + 6, y: h.y + 6, width: h.width - 12, height: h.height - 12 };
            return !!t && !!q && inside(t, vp) && inside(q, vp) && !overlap(t, q);
          }, { message: `step ${step.id}` })
          .toBe(true);
      }
      await expectNoHorizontalOverflow(p);
      await p.screenshot({ path: `e2e/screenshots/tour/${locale}-${String(k).padStart(2, '0')}-${step.id}.png` });
      await p.getByTestId('tour-next').click();
    }

    // Leaving the tour brings the real (empty) household straight back; nothing was written to it.
    await expect(p.getByTestId('tour')).toHaveCount(0);
    await expect(p.getByTestId('demo-badge')).toHaveCount(0);
    await p.goto('/');
    await expect(p.getByTestId('onboarding')).toBeVisible();
    const tx = await (await p.request.get('/api/transactions?from=2000-01-01&to=2100-01-01')).json();
    expect(tx.summary.count).toBe(0);
    expect((await (await p.request.get('/api/accounts')).json()).accounts).toHaveLength(0);
    await ctx.close();
  });
}

test('page ⓘ runs that page’s steps; Esc ends it and restores real data', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/forecast');
  await page.getByTestId('page-tour').click();
  await expect(page.getByTestId('tour-popover')).toHaveAttribute('data-step', 'forecastEom');
  await expect(page.getByTestId('tour-progress')).toHaveText('1/2');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-popover')).toHaveAttribute('data-step', 'cushion');
  await expect(page.getByTestId('tour-text')).toContainText('minimum balance');
  // the same one-liner sits next to the term on the page itself (a native <details> toggle)
  await expect(page.getByTestId('cushion-term')).toContainText('Safety cushion');
  await expect(page.getByTestId('cushion-hint')).toContainText('minimum balance');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toHaveCount(0);
  await expect(page.getByTestId('demo-badge')).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
});
