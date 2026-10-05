import { test, expect } from '../support/fixtures.js';
import { Api } from '../support/api.js';
import { routes } from '../support/journey.js';
import { editorText, isMobile, press, typeIntoEditor, waitForLive } from '../support/ui.js';
import type { Page } from '@playwright/test';

/** Journey 8 — Loki: a transform, the regex tester, and a Calcifer run under the admin policy. */

/** Desktop shows the transforms in a rail; a phone opens a group's actions as a sheet. */
async function transform(page: Page, group: string, action: string): Promise<void> {
  if (isMobile(page)) {
    await press(
      page,
      page.getByRole('toolbar', { name: 'Transform groups' }).getByRole('button', { name: group }),
    );
    // A sheet action's name is its label followed by its hint.
    await press(
      page,
      page
        .getByRole('dialog', { name: 'Transform actions' })
        .getByRole('button', { name: new RegExp(`^${action}\\b`) }),
    );
  } else {
    await page
      .getByRole('complementary', { name: 'Transforms' })
      .getByRole('button', { name: action, exact: true })
      .click();
  }
}

test.describe('loki', () => {
  test('beautify and minify reshape the buffer', routes('/loki'), async ({ page }) => {
    await page.goto('/loki');
    await typeIntoEditor(page, 'function add(a,b){return a+b}');
    await expect(page.getByRole('status').filter({ hasText: 'Parses cleanly' })).toBeVisible();
    await transform(page, 'Format', 'Beautify');
    await expect(editorText(page)).toContainText('return a + b;');
    await transform(page, 'Format', 'Minify');
    await expect(page.locator('.loki-status__minify')).toContainText('smaller');
  });

  test('the regex tester lists matches and groups', routes('/loki'), async ({ page }) => {
    await page.goto('/loki');
    await page
      .getByRole('group', { name: 'Loki mode' })
      .getByRole('button', { name: 'Regex' })
      .click();
    await page.getByPlaceholder('\\bword\\b').fill('(\\w+)@(\\w+)');
    await page.getByLabel('Flags').fill('g');
    await typeIntoEditor(page, 'odin@asgard and thor@midgard');
    await expect(page.locator('.loki-regex__count')).toHaveText('2 matches');
    const rows = page.locator('.loki-regex__table tbody tr');
    await expect(rows.nth(0)).toContainText('odin@asgard');
    await expect(rows.nth(1)).toContainText('2: midgard');

    await page.getByPlaceholder('\\bword\\b').fill('(unclosed');
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test(
    'Calcifer runs code, and an admin can turn it off live',
    routes('/loki'),
    async ({ page, ownServer }) => {
      // Turning execution off is process-wide, so it gets a server of its own.
      const server = await ownServer();
      await page.goto(`${server.baseUrl}/loki`);
      await waitForLive(page);
      await typeIntoEditor(page, 'console.log("from the hearth"); 6 * 7');
      await page.getByRole('button', { name: 'Run' }).click();
      await expect(page.locator('.loki-output__body')).toContainText('from the hearth');
      await expect(page.locator('.loki-line--result')).toContainText('42');

      const admin = await new Api(server.baseUrl).login(server.pin);
      await admin.patch('/api/loki/settings', { executionEnabled: false });
      await expect(page.getByRole('button', { name: 'Run' })).toBeHidden();
      await expect(page.getByText('(sandboxed execution) is turned off in Heimdall')).toBeVisible();
    },
  );
});
