import { test, expect } from '../support/fixtures.js';
import { Api } from '../support/api.js';
import { routes } from '../support/journey.js';
import { startTitleSink, titleFor } from '../support/sink.js';
import { waitForLive } from '../support/ui.js';

/**
 * Journey 9 — Accio: a saved link's title is enriched from a local HTTP sink
 * (never the internet), tags, search, edit, delete, and the infinite scroll
 * with its Load more fallback. Exact counts, so a server of its own.
 */
test(
  'Accio shelves, enriches, filters and scrolls',
  routes('/accio'),
  async ({ page, ownServer, newDevice }) => {
    const sink = await startTitleSink();
    try {
      const server = await ownServer();
      const seed = new Api(server.baseUrl);
      for (let index = 0; index < 35; index += 1) {
        await seed.post('/api/accio', {
          url: `https://example.invalid/${index}`,
          title: `Seeded link ${String(index).padStart(2, '0')}`,
          tags: ['seeded'],
        });
      }

      const deviceB = await newDevice({ baseURL: server.baseUrl });
      await deviceB.goto('/accio');
      await waitForLive(deviceB);

      await page.goto(`${server.baseUrl}/accio`);
      await waitForLive(page);
      const cards = page.locator('article.shelf-card');
      await expect(cards).toHaveCount(30);

      // Saved with no title: shelved at once, then titled by the server's fetch.
      const url = `${sink.baseUrl}/page/heimdall`;
      await page.getByPlaceholder('Paste a URL and press Enter…').fill(url);
      await page.getByPlaceholder('comma, separated').fill('lore');
      await page.getByRole('button', { name: 'Accio', exact: true }).click();
      const card = page.locator('article.shelf-card').filter({ hasText: titleFor('heimdall') });
      await expect(card).toBeVisible();
      await expect(
        deviceB.locator('article.shelf-card').filter({ hasText: titleFor('heimdall') }),
      ).toBeVisible();
      expect(sink.hits).toContain('/page/heimdall');

      await page
        .getByRole('group', { name: 'Filter by tag' })
        .getByRole('button', { name: 'lore' })
        .click();
      await expect(cards).toHaveCount(1);
      await page
        .getByRole('group', { name: 'Filter by tag' })
        .getByRole('button', { name: 'All' })
        .click();

      await page.getByPlaceholder('Search titles and addresses…').fill('Seeded link 1');
      await expect(cards).toHaveCount(10);
      await page.getByPlaceholder('Search titles and addresses…').fill('');

      // The scroll: the first batch, then the rest by scrolling or Load more.
      await expect(cards).toHaveCount(30);
      await page.locator('.load-more').scrollIntoViewIfNeeded();
      const more = page.getByRole('button', { name: 'Load more' });
      if (await more.isVisible()) await more.click().catch(() => undefined);
      await expect(cards).toHaveCount(36);
      await expect(page.locator('.load-more')).toHaveCount(0);

      await card.getByRole('button', { name: `Edit ${titleFor('heimdall')}` }).click();
      const edited = page
        .locator('article.shelf-card')
        .filter({ has: page.getByRole('button', { name: 'Save' }) });
      await edited.getByLabel('Title').fill('The watchman');
      await edited.getByRole('button', { name: 'Save' }).click();
      const renamed = page.locator('article.shelf-card').filter({ hasText: 'The watchman' });
      await expect(renamed).toBeVisible();

      await renamed.getByRole('button', { name: 'Delete The watchman' }).click();
      await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(renamed).toBeHidden();
      await expect(
        deviceB.locator('article.shelf-card').filter({ hasText: 'The watchman' }),
      ).toBeHidden();
    } finally {
      await sink.close();
    }
  },
);
