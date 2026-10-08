import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import { showCode, typeIntoEditor, waitForLive } from '../support/ui.js';

/**
 * PLAN-35 criterion 4 — the hub build with its server gone: a server action
 * shows "The Bifröst is closed" with "Try again" (and "Download instead" where
 * there is a local copy to offer), repeated failures never stack a second
 * sheet, and once the server is back the sheet closes and the action
 * succeeds. Stops a server, so it has one of its own.
 */
test(
  'the server stops mid-session: the sheet, Try again, and the save that then lands',
  routes('/runestone'),
  async ({ page, ownServer, guard }) => {
    const server = await ownServer();
    await page.goto(`${server.baseUrl}/runestone`);
    await waitForLive(page);
    await page.getByLabel('Document title').fill('Across a closed bridge');
    await showCode(page);
    await typeIntoEditor(page, '{"realm":"midgard"}');

    guard.allowConnectionLoss();
    // On the way back up the web host can answer before the API behind it is
    // ready, and the page's event-stream retry then gets its 502 (PLAN-36).
    guard.allowApiOutage();
    await server.halt();
    const save = page.getByRole('button', { name: 'Save to Pensieve' });
    await save.click();
    const sheet = page.getByRole('alertdialog', { name: 'The Bifröst is closed' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Download instead' })).toBeVisible();

    // A second failure merges into the open sheet rather than stacking another.
    // Dispatched to the button itself: a pointer click would land on the
    // sheet's scrim, which is the sheet doing its job.
    await save.dispatchEvent('click');
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(1);

    await ownServer({
      port: server.port,
      apiPort: server.apiPort,
      storageRoot: server.storageRoot,
    });
    // Two ways the sheet closes, and either may win: the person asks (Try
    // again), or the event stream reconnects and closes it on its own, even
    // mid-click. Retry until it is gone by whichever path.
    const retry = sheet.getByRole('button', { name: 'Try again' });
    await expect(async () => {
      if (await retry.isVisible()) await retry.click({ timeout: 1_000 });
      await expect(sheet).toBeHidden({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Runestone carved' })).toBeVisible();
    await expect(page).toHaveURL(/\/runestone\/[a-z0-9-]+$/);
  },
);

/**
 * PLAN-36 criteria 5 and 9 — only the API stops, and the web host in front of
 * it keeps running: pages still load (the web host serves every chunk), a
 * server action gets the web host's 502 and shows the same sheet, a `/go`
 * link shows the closed page rather than raw JSON, and starting the API again
 * closes the sheet and the action lands.
 */
test(
  'only the API stops: pages still load, the sheet opens from the 502, and a restart closes it',
  routes('/runestone', '/hermes'),
  async ({ page, ownServer, guard, newDevice }) => {
    const server = await ownServer();
    await page.goto(`${server.baseUrl}/runestone`);
    await waitForLive(page);
    await page.getByLabel('Document title').fill('Across a half-closed bridge');
    await showCode(page);
    await typeIntoEditor(page, '{"realm":"asgard"}');

    guard.allowApiOutage();
    await server.haltApi();
    const save = page.getByRole('button', { name: 'Save to Pensieve' });
    await save.click();
    const sheet = page.getByRole('alertdialog', { name: 'The Bifröst is closed' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();

    // The web host still serves the client: a fresh tab loads a page whose
    // code it has never fetched, and only its API calls fail.
    const other = await newDevice();
    await other.goto(`${server.baseUrl}/hermes`);
    await expect(other.getByRole('alertdialog', { name: 'The Bifröst is closed' })).toBeVisible();

    // A /go link is followed by a person, so it gets a page, not JSON.
    const go = await fetch(`${server.baseUrl}/go/anything`);
    expect(go.status).toBe(503);
    expect(go.headers.get('content-type')).toContain('text/html');
    expect(await go.text()).toContain('The Bifröst is closed');

    await server.restartApi();
    const retry = sheet.getByRole('button', { name: 'Try again' });
    await expect(async () => {
      if (await retry.isVisible()) await retry.click({ timeout: 1_000 });
      await expect(sheet).toBeHidden({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Runestone carved' })).toBeVisible();
  },
);
