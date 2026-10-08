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

    await ownServer({ port: server.port, storageRoot: server.storageRoot });
    // The event stream may reconnect and close the sheet first; otherwise the
    // person asks for it.
    const retry = sheet.getByRole('button', { name: 'Try again' });
    if (await retry.isVisible()) await retry.click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });

    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Runestone carved' })).toBeVisible();
    await expect(page).toHaveURL(/\/runestone\/[a-z0-9-]+$/);
  },
);
