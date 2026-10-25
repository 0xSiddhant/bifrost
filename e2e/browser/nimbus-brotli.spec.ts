import { test, expect } from '../support/fixtures.js';
import { Api } from '../support/api.js';
import { downloadBytes } from '../support/files.js';
import { routes } from '../support/journey.js';
import { editorText, showCode, typeIntoEditor } from '../support/ui.js';
import { brotliDecompressSync } from 'node:zlib';

/** Journeys 11 (Nimbus) and 12 (Brotli). */

test(
  'Nimbus: a busy bridge refuses a second flight, then a small test lands',
  routes('/nimbus'),
  async ({ page, server }) => {
    await page.goto('/nimbus');
    await page
      .getByRole('group', { name: 'Test size' })
      .getByRole('button', { name: '10 MB' })
      .click();

    // Another device's test holds the single-flight lease (it lingers for a
    // grace period after its last request): this one must be told, not measured.
    const other = new Api(server.baseUrl, 'e2e-other-broom');
    await other.get('/api/v1/nimbus/down?mb=1');
    await page.getByRole('button', { name: /Fly/ }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'another broom is flying' }),
    ).toBeVisible();

    await other.post('/api/v1/nimbus/release');
    await page.getByRole('button', { name: /Fly/ }).click();
    await expect(page.getByText(/10 MB each way · recorded/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  },
);

const SOURCE = JSON.stringify({
  realm: 'midgard',
  bridges: Array.from({ length: 40 }, (_, index) => `bridge-${index}`),
});

test.describe('brotli', () => {
  test(
    'compress → download → decompress by file and by pasted base64 → open in the detected tool',
    routes('/brotli'),
    async ({ page }) => {
      await page.goto('/brotli');
      await page.getByLabel('Text to compress').fill(SOURCE);
      // The mode toggle is also named "Compress"; the action lives in the panel.
      await page
        .locator('.brotli-panel')
        .getByRole('button', { name: 'Compress', exact: true })
        .click();
      await expect(page.locator('.brotli-sizes').first()).toContainText('smaller with Brotli');

      const [br] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download .br' }).click(),
      ]);
      expect(br.suggestedFilename()).toMatch(/\.br$/);
      const compressed = await downloadBytes(br);
      // The bytes are standard Brotli: Node's own decoder reads them back.
      expect(brotliDecompressSync(compressed).toString('utf8')).toBe(SOURCE);

      await page
        .getByRole('group', { name: 'Mode' })
        .getByRole('button', { name: 'Decompress', exact: true })
        .click();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'doc.json.br',
        mimeType: 'application/octet-stream',
        buffer: compressed,
      });
      await page
        .locator('.brotli-panel')
        .getByRole('button', { name: 'Decompress', exact: true })
        .click();
      await expect(page.locator('.brotli-result')).toContainText('text');

      await page
        .getByRole('group', { name: 'Mode' })
        .getByRole('button', { name: 'Compress', exact: true })
        .click();
      await page
        .getByRole('group', { name: 'Mode' })
        .getByRole('button', { name: 'Decompress', exact: true })
        .click();
      await page.getByLabel('Base64-encoded Brotli data').fill(compressed.toString('base64'));
      await page
        .locator('.brotli-panel')
        .getByRole('button', { name: 'Decompress', exact: true })
        .click();
      const open = page.getByRole('button', { name: /Open in Runestone/ });
      await expect(open).toBeVisible();
      await open.click();
      await expect(page).toHaveURL(/\/runestone$/);
      await showCode(page);
      await expect(editorText(page)).toContainText('bridge-39');
    },
  );

  test(
    'an editor hands its document to Brotli, which compresses on arrival',
    routes('/brotli'),
    async ({ page }) => {
      await page.goto('/runestone');
      await showCode(page);
      await typeIntoEditor(page, SOURCE);
      await page.getByRole('button', { name: 'Brotli', exact: true }).click();
      await expect(page).toHaveURL(/\/brotli$/);
      await expect(page.getByText(/Sent from .* — compressed on arrival\./)).toBeVisible();
      await expect(page.locator('.brotli-sizes').first()).toContainText('smaller with Brotli');
    },
  );
});
