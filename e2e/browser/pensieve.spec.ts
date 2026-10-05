import { test, expect } from '../support/fixtures.js';
import { Api, saveDocument, type DocumentKind } from '../support/api.js';
import { routes } from '../support/journey.js';
import { acceptNextDialog } from '../support/ui.js';

/**
 * Journey 6 — the Pensieve: paging across kinds, the type chip, the author
 * filter, the live "library changed" chip on a later page, and this device's
 * own delete. Counts must be exact, so it runs on a server of its own.
 */
test(
  'the Pensieve pages across kinds, filters, and stays live',
  routes('/pensieve'),
  async ({ page, ownServer }) => {
    const server = await ownServer();
    const seed = new Api(server.baseUrl, 'e2e-seed-device');
    const other = new Api(server.baseUrl, 'e2e-other-device');
    const plan: [DocumentKind, number, string][] = [
      ['runestone', 20, '{"n":1}'],
      ['edda', 15, '# n\n'],
      ['groot', 3, 'n: 1\n'],
      ['atlas', 2, '<n/>\n'],
    ];
    for (const [kind, count, content] of plan) {
      for (let index = 0; index < count; index += 1)
        await saveDocument(seed, kind, content, `${kind} ${String(index).padStart(2, '0')}`);
    }
    await saveDocument(other, 'groot', 'from: elsewhere\n', 'elsewhere one');
    await saveDocument(other, 'groot', 'from: elsewhere\n', 'elsewhere two');

    await page.goto(`${server.baseUrl}/pensieve`);
    const status = page.locator('.lib-status');
    await expect(status).toContainText('Showing 1–30 of 42');
    await expect(page.locator('.lib-row')).toHaveCount(30);

    const pages = page.getByRole('navigation', { name: 'Pages' });
    await pages.getByRole('link', { name: 'Next page' }).click();
    await expect(status).toContainText('Showing 31–42 of 42');
    await expect(page.locator('.lib-row')).toHaveCount(12);

    // Another device saves while this one is on a later page: the rows stay put
    // and a chip offers the refresh.
    await saveDocument(other, 'edda', '# late\n', 'arrived later');
    await expect(page.getByText('The library changed')).toBeVisible();
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(status).toContainText('of 43');

    // One kind: no merge, and its own count.
    await page
      .getByRole('group', { name: 'Filter by type' })
      .getByRole('button', { name: 'Markdown' })
      .click();
    await expect(status).toContainText('Showing 1–16 of 16');
    await page
      .getByRole('group', { name: 'Filter by type' })
      .getByRole('button', { name: 'All' })
      .click();
    await expect(status).toContainText('of 43');

    await page.getByLabel('Filter by device').selectOption('e2e-other-device');
    await expect(status).toContainText('Showing 1–3 of 3');
    await expect(page.locator('.lib-row').filter({ hasText: 'elsewhere one' })).toBeVisible();
    await page.getByLabel('Filter by device').selectOption('');

    await page.getByPlaceholder('Search by name…').fill('runestone 1');
    await expect(status).toContainText('of 10');
    await page.getByPlaceholder('Search by name…').fill('');

    // This device's own delete refetches in place — no "library changed" chip.
    await expect(status).toContainText('Showing 1–30 of 43');
    const victim = page.locator('.lib-row').first();
    const victimName = (await victim.locator('.lib-row__name').textContent()) ?? '';
    acceptNextDialog(page);
    await victim.getByRole('button', { name: `Delete ${victimName}` }).click();
    await expect(status).toContainText('Showing 1–30 of 42');
    await expect(page.locator('.lib-row__name', { hasText: victimName })).toHaveCount(0);
    await expect(page.getByText('The library changed')).toBeHidden();
  },
);
