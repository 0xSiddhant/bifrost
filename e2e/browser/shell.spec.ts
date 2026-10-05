import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import { mainNav, navigate, press, waitForLive } from '../support/ui.js';

/** Journey 1 — the shell: Midgard, the three hubs, nav, themes, guides, deep links, 404. */

test.describe('shell', () => {
  test('Midgard shows the transfer doors and the join card', routes('/'), async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your devices/ })).toBeVisible();
    for (const door of ['Send files', 'Receive files', 'Hermes', 'Accio', 'Saga']) {
      await expect(page.getByRole('link', { name: new RegExp(door) }).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Join Bifrost' })).toBeVisible();
    await waitForLive(page);
  });

  test(
    'the nav reaches every hub, each listing its tools',
    routes('/ollivanders', '/diagon-alley'),
    async ({ page }) => {
      await page.goto('/');
      await expect(mainNav(page).getByRole('link')).toHaveText([
        'Midgard',
        'Ollivanders',
        'Diagon Alley',
      ]);

      await navigate(page, 'Ollivanders');
      await expect(page).toHaveURL(/\/ollivanders$/);
      for (const tool of [
        'Runestone',
        'Variant',
        'Edda',
        'Loki',
        'Pensieve',
        'Groot',
        'Atlas',
        'Brotli',
      ]) {
        await expect(page.getByRole('link', { name: new RegExp(tool) }).first()).toBeVisible();
      }

      await navigate(page, 'Diagon Alley');
      await expect(page).toHaveURL(/\/diagon-alley$/);
      const toolbox = page.getByRole('group', { name: 'Toolbox' });
      for (const tool of ['Nimbus', 'Portkey', 'Make a QR', 'Base64', 'UUID', 'SHA-256']) {
        await expect(toolbox.getByText(tool, { exact: true })).toBeVisible();
      }

      await navigate(page, 'Midgard');
      await expect(page).toHaveURL(/\/$/);
    },
  );

  test('a theme choice survives a reload', routes('/'), async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /open theme picker/ }).click();
    await page.getByRole('menuitemradio', { name: /Daybreak/ }).click();
    await expect(page.getByRole('button', { name: /Theme: Daybreak/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: /Theme: Daybreak/ })).toBeVisible();

    await page.getByRole('button', { name: /open theme picker/ }).click();
    await page.getByRole('menuitemradio', { name: /Tokyo/ }).click();
    await expect(page.getByRole('button', { name: /Theme: Tokyo/ })).toBeVisible();
  });

  test('every page with a format has a guide, and the others have none', async ({ page }) => {
    const guides: [string, string][] = [
      ['/runestone', 'JSON'],
      ['/edda', 'Markdown'],
      ['/atlas', 'XML'],
      ['/groot', 'YAML'],
      ['/loki', 'JavaScript'],
      ['/brotli', 'Brotli'],
    ];
    for (const [path, title] of guides) {
      await page.goto(path);
      await page.getByRole('button', { name: `${title} guide` }).click();
      const panel = page.getByRole('complementary', { name: `${title} guide` });
      await expect(panel.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
      await press(page, page.getByRole('button', { name: 'Close guide' }));
      await expect(panel).toBeHidden();
    }
    await page.goto('/');
    await expect(page.getByRole('button', { name: /guide$/ })).toHaveCount(0);
  });

  test(
    'legacy and deep links land on the page they now mean',
    routes(
      '/muninn',
      '/sigil',
      '/runestone/pensieve',
      '/runestone/library',
      '/runestone/mimir',
      '/edda/pensieve',
      '/edda/library',
      '/groot/pensieve',
      '/groot/library',
      '/atlas/pensieve',
      '/atlas/library',
    ),
    async ({ page }) => {
      const redirects: [string, RegExp][] = [
        ['/muninn', /\/hermes$/],
        ['/sigil', /\/diagon-alley\/qr$/],
        ['/runestone/pensieve', /\/pensieve\?type=runestone$/],
        ['/runestone/library', /\/pensieve\?type=runestone$/],
        ['/runestone/mimir', /\/pensieve\?type=runestone$/],
        ['/edda/pensieve', /\/pensieve\?type=edda$/],
        ['/edda/library', /\/pensieve\?type=edda$/],
        ['/groot/pensieve', /\/pensieve\?type=groot$/],
        ['/groot/library', /\/pensieve\?type=groot$/],
        ['/atlas/pensieve', /\/pensieve\?type=atlas$/],
        ['/atlas/library', /\/pensieve\?type=atlas$/],
        ['/diagon-alley/no-such-tool', /\/diagon-alley$/],
      ];
      for (const [from, to] of redirects) {
        await page.goto(from);
        await expect(page, `${from} should redirect`).toHaveURL(to);
      }
    },
  );

  test('an unknown address shows the 404 page, which leads home', routes('*'), async ({ page }) => {
    await page.goto('/no-such-realm/at/all');
    await expect(page.getByText('404 — off the bridge')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Midgard' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
