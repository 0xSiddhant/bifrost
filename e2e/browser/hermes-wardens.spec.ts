import { test, expect } from '../support/fixtures.js';
import { Api } from '../support/api.js';
import { routes } from '../support/journey.js';
import { waitForLive } from '../support/ui.js';

/** Journeys 3 (Hermes, the shared clipboard) and 4 (Wardens, the devices). */

test.describe('hermes', () => {
  test(
    'a post on one device appears live on another, copies, and deletes everywhere',
    routes('/hermes'),
    async ({ page, newDevice }) => {
      const text = `meet at the bridge ${Date.now().toString(36)}`;
      const deviceB = await newDevice();
      await deviceB.goto('/hermes');
      await waitForLive(deviceB);

      await page.goto('/hermes');
      await waitForLive(page);
      await page.getByLabel('Share text').fill(text);
      await page.getByRole('button', { name: 'Share to devices' }).click();

      const onB = deviceB.locator('.clip-entry').filter({ hasText: text });
      await expect(onB).toBeVisible();

      await onB.getByRole('button', { name: 'Copy' }).click();
      await expect(onB.getByRole('button', { name: 'Copied' })).toBeVisible();

      await page
        .locator('.clip-entry')
        .filter({ hasText: text })
        .getByRole('button', { name: 'Delete entry' })
        .click();
      await expect(onB).toBeHidden();
    },
  );

  test('a code snippet keeps its language badge', routes('/hermes'), async ({ page }) => {
    await page.goto('/hermes');
    await page.getByLabel('Share text').fill('const answer = 42;');
    await page.getByText('Code snippet').click();
    await page.getByPlaceholder('language (e.g. ts, py)').fill('ts');
    await page.getByRole('button', { name: 'Share to devices' }).click();
    const entry = page.locator('.clip-entry').filter({ hasText: 'const answer = 42;' });
    await expect(entry.locator('.badge', { hasText: 'ts' })).toBeVisible();
  });

  test(
    'an entry with a time-to-live is gone once it expires',
    routes('/hermes'),
    async ({ page, server }) => {
      // Expiry is the server's clock, not the page's — so this waits out a real
      // one-second TTL (set through the API, as `bifrost clip --ttl` does)
      // rather than faking time in the browser, which the server never sees.
      const text = `self-destructing ${Date.now().toString(36)}`;
      await new Api(server.baseUrl).post('/api/clipboard', { text, ttlSeconds: 1 });
      await page.goto('/hermes');
      const entry = page.locator('.clip-entry').filter({ hasText: text });
      await expect(entry).toBeVisible();
      await page.waitForTimeout(1_200);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Hermes' })).toBeVisible();
      await expect(entry).toBeHidden();
    },
  );
});

test.describe('wardens', () => {
  test(
    'both devices are listed, and a rename reaches the other one live',
    routes('/wardens'),
    async ({ page, newDevice }) => {
      const name = `Hall ${Date.now().toString(36).slice(-4)}`;
      const deviceB = await newDevice();
      await deviceB.goto('/wardens');
      await waitForLive(deviceB);

      await page.goto('/wardens');
      await waitForLive(page);
      await expect(page.locator('.device-row').filter({ hasText: 'online' }).first()).toBeVisible();
      expect(await page.locator('.device-row').count()).toBeGreaterThanOrEqual(2);

      const self = page.locator('.device-row').filter({ hasText: 'this device' });
      await self.getByLabel('Device name').fill(name);
      await self.getByRole('button', { name: 'Save' }).click();
      await expect(deviceB.locator('.device-row').filter({ hasText: name })).toBeVisible();

      // Clearing the name falls back to the device's character alias.
      await self.getByLabel('Device name').fill('');
      await self.getByRole('button', { name: 'Save' }).click();
      await expect(deviceB.locator('.device-row').filter({ hasText: name })).toBeHidden();
    },
  );
});
