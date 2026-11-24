import { expect, test, type Page } from '@playwright/test';
import { ensureAdmin, signIn } from './auth';
import { expectNoHorizontalOverflow } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => ensureAdmin(browser));

const shownIds = (page: Page) => page.getByTestId('home-edit-shown').locator('[data-testid="home-edit-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));
const homeIds = (page: Page) => page.locator('[data-widget]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')));

/** Drags a row's grip onto another row (pointer down, a few moves, up), the way a finger or mouse would. */
async function drag(page: Page, from: string, onto: string) {
  await page.evaluate(() => window.scrollTo(0, 0)); // both rows on screen, away from the edge-scroll zones
  const grip = page.locator(`[data-testid="home-edit-row"][data-widget="${from}"] [data-testid="sortable-grip"]`);
  const target = page.locator(`[data-testid="home-edit-row"][data-widget="${onto}"]`);
  const a = (await grip.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const steps = 8;
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  for (let k = 1; k <= steps; k++) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + (dy * k) / steps + Math.sign(dy) * 4);
  await page.mouse.up();
}

test('customize Home: remove, add, drag to reorder; saved to the profile; back to default', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/');
  await expect(page.getByTestId('hero-card')).toBeVisible();
  await page.getByTestId('home-edit').click();
  await expect(page).toHaveURL(/edit=1/);
  const editor = page.getByTestId('home-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('home-edit-reset')).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'e2e/screenshots/home-edit.png' });

  // remove "Coming up", add "Latest transactions" (it goes to the end)
  await editor.locator('[data-testid="home-edit-row"][data-widget="upcoming"] [data-testid="home-edit-remove"]').click();
  await editor.locator('[data-testid="home-edit-add"][data-widget="recent"]').click();
  let ids = await shownIds(page);
  expect(ids).not.toContain('upcoming');
  expect(ids.at(-1)).toBe('recent');
  await expect(editor.locator('[data-testid="home-edit-add"][data-widget="upcoming"]')).toBeVisible();

  // drag the donut above the hero
  await drag(page, 'donut', 'hero');
  await expect.poll(() => shownIds(page).then((x) => x.slice(0, 2))).toEqual(['donut', 'hero']);
  // keyboard: arrow down on a grip moves it one place
  await editor.locator('[data-testid="home-edit-row"][data-widget="donut"] [data-testid="sortable-grip"]').press('ArrowDown');
  await expect.poll(() => shownIds(page).then((x) => x.slice(0, 2))).toEqual(['hero', 'donut']);
  await drag(page, 'donut', 'hero');
  await expect.poll(() => shownIds(page).then((x) => x.slice(0, 2))).toEqual(['donut', 'hero']);
  ids = await shownIds(page);

  // Done: Home follows the new layout; it's on the profile, so it survives a reload (or a new device)
  await page.getByTestId('home-edit-done').click();
  await expect(page).not.toHaveURL(/edit=1/);
  await expect(page.getByTestId('home-recent')).toBeVisible();
  await expect(page.locator('[data-widget="upcoming"]')).toHaveCount(0);
  await expect.poll(async () => (await page.request.get('/api/me').then((r) => r.json())).user.homeWidgets).toEqual(ids);
  await page.reload();
  await expect(page.getByTestId('home-recent')).toBeVisible();
  const visible = await homeIds(page);
  expect(visible.indexOf('donut')).toBeLessThan(visible.indexOf('hero'));
  await expectNoHorizontalOverflow(page);

  // Back to default
  await page.getByTestId('home-edit-bottom').click();
  await page.getByTestId('home-edit-reset').click();
  await expect(page.getByTestId('home-edit-reset')).toBeDisabled();
  await page.getByTestId('home-edit-done').click();
  await expect(page.getByTestId('home-recent')).toHaveCount(0);
  await expect.poll(async () => (await page.request.get('/api/me').then((r) => r.json())).user.homeWidgets).toBeNull();
});

test('an empty Home offers to add widgets', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/?edit=1');
  const editor = page.getByTestId('home-editor');
  const remove = editor.getByTestId('home-edit-remove');
  await expect(remove.first()).toBeVisible();
  // remove everything quickly: the saves queue up and none is undone by a profile refresh in between
  for (let n = await remove.count(); n > 0; n--) {
    await remove.first().click();
    await expect(remove).toHaveCount(n - 1);
  }
  await expect(editor.getByText('Nothing on Home yet')).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/me').then((r) => r.json())).user.homeWidgets).toEqual([]);
  await page.getByTestId('home-edit-done').click();
  await expect(page.getByText('Your Home is empty')).toBeVisible();
  await page.getByRole('button', { name: 'Customize Home' }).last().click();
  await page.getByTestId('home-edit-reset').click();
  await page.getByTestId('home-edit-done').click();
  await expect(page.getByTestId('hero-card')).toBeVisible();
});
