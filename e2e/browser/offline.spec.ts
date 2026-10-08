import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import { mainNav, waitForLive } from '../support/ui.js';

/**
 * Journey 17 — offline mode: with the switch on, a warmed page still opens
 * after the hub is out of reach; an un-warmed one shows the route boundary
 * panel, never the app-wide crash card. Out of reach means the web host is
 * gone (PLAN-36): it serves the chunks, so with it stopped nothing the page
 * has not cached can arrive, whether or not the API behind it still runs.
 * Stops a server, so it has one of its own.
 */
test(
  'a warmed page opens with the bridge down; an un-warmed one says so calmly',
  routes('/ollivanders'),
  async ({ page, ownServer, guard }) => {
    const server = await ownServer();
    await page.goto(`${server.baseUrl}/ollivanders`);
    await waitForLive(page);
    await page.getByRole('switch', { name: /Offline mode/ }).check();
    await expect(page.locator('.offline-toggle__pill')).toHaveClass(/is-ready/, {
      timeout: 20_000,
    });

    guard.allowConnectionLoss();
    await server.haltWeb();
    // The event stream notices first: the footer stops reading `open`.
    await expect(page.locator('.shell-footer')).not.toContainText(/\bopen\b/, { timeout: 20_000 });

    // Warmed: Runestone's code is already in the tab.
    await page
      .getByRole('link', { name: /Runestone/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/runestone$/);
    await expect(page.getByLabel('Document title')).toBeVisible();

    // Not warmed: Brotli is not in the registry, so its chunk cannot arrive.
    await mainNav(page).getByRole('link', { name: 'Ollivanders' }).click();
    await page
      .getByRole('link', { name: /Brotli/ })
      .first()
      .click();
    // One notification plus an inline panel (PLAN-22): both say it.
    await expect(page.getByText('Not available offline')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    // The shell is still standing around the panel.
    await expect(mainNav(page).getByRole('link', { name: 'Midgard' })).toBeVisible();
  },
);
