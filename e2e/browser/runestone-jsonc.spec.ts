import { test, expect } from '../support/fixtures.js';
import { downloadBytes } from '../support/files.js';
import { routes } from '../support/journey.js';
import { editorText, press, showCode } from '../support/ui.js';

/**
 * Journey — Runestone JSONC (PLAN-42): a `.jsonc` file imports as JSONC,
 * saves as JSONC, comes back as JSONC on a reload, is served raw as
 * `application/jsonc`, is found by the Pensieve's format filter and reopens
 * from it, compares in Variant by value (a comment-only change is no
 * difference), and exports as `.jsonc` with its comments.
 */

const SETTINGS = [
  '{',
  '  // where the bridge listens',
  '  "port": 4646,',
  '  /* the household name */ "name": "bifrost",',
  '  "realms": ["midgard", "asgard",],',
  '}',
].join('\n');

/** The same values, other comments: Variant must see no difference. */
const RECOMMENTED = [
  '{',
  '  "port": 4646, // still the default',
  '  "name": "bifrost",',
  '  /* nine in all, two here */',
  '  "realms": ["midgard", "asgard"],',
  '}',
].join('\n');

test.describe('runestone jsonc', () => {
  test(
    'import → save → reload → raw → pensieve filter → variant → export',
    routes('/runestone', '/runestone/:slug', '/pensieve', '/variant'),
    async ({ page, server }) => {
      const stamp = Date.now().toString(36);
      const title = `E2E jsonc ${stamp}`;
      await page.goto('/runestone');
      const formats = page.getByRole('group', { name: 'Document format' });
      await expect(formats.getByRole('radio', { name: 'JSON', exact: true })).toBeChecked();

      // A .jsonc file selects JSONC.
      await page.locator('input[type="file"][accept*=".jsonc"]').setInputFiles({
        name: `${title}.jsonc`,
        mimeType: 'application/jsonc',
        buffer: Buffer.from(SETTINGS),
      });
      await expect(formats.getByRole('radio', { name: 'JSONC' })).toBeChecked();
      await expect(page.getByLabel('Document title')).toHaveValue(title);
      await expect(page.locator('.rune-status')).toContainText('Valid JSONC');

      // The switch never touches the text: JSON calls the comments errors.
      await press(page, formats.getByRole('radio', { name: 'JSON', exact: true }));
      await expect(page.locator('.rune-status')).toContainText(/errors? in JSON/);
      await expect(page.getByRole('button', { name: 'Save to Pensieve' })).toBeDisabled();
      await press(page, formats.getByRole('radio', { name: 'JSONC' }));
      await expect(page.locator('.rune-status')).toContainText('Valid JSONC');

      await page.getByRole('button', { name: 'Save to Pensieve' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Runestone carved' })).toBeVisible();
      await expect(page).toHaveURL(/\/runestone\/[a-z0-9-]+$/);
      const slug = new URL(page.url()).pathname.replace('/runestone/', '');

      await page.reload();
      await expect(formats.getByRole('radio', { name: 'JSONC' })).toBeChecked();
      await showCode(page);
      await expect(editorText(page)).toContainText('// where the bridge listens');

      const raw = await page.request.get(`${server.baseUrl}/runestone/api/v1/${slug}`);
      expect(raw.headers()['content-type']).toBe('application/jsonc; charset=utf-8');
      expect(raw.headers()['access-control-allow-origin']).toBe('*');
      expect(await raw.text()).toBe(SETTINGS);

      // Export keeps the extension, the media type and the comments.
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export', exact: true }).click(),
      ]);
      expect(file.suggestedFilename()).toBe(`${title}.jsonc`);
      expect((await downloadBytes(file)).toString('utf8')).toBe(SETTINGS);

      // A strict JSON document and a second JSONC one, beside it.
      const strictName = `E2E strict ${stamp}`;
      const strict = await page.request.post(`${server.baseUrl}/api/v1/runestone`, {
        data: { name: strictName, content: '{"port": 4646}' },
      });
      expect((await strict.json()).format).toBe('json');
      const twin = await page.request.post(`${server.baseUrl}/api/v1/runestone`, {
        data: { name: `E2E recommented ${stamp}`, content: RECOMMENTED, format: 'jsonc' },
      });
      expect(twin.status()).toBe(201);
      const twinSlug = (await twin.json()).slug as string;

      // The Pensieve: one kind, a badge per row, and a format filter.
      await page.goto('/pensieve?type=runestone');
      const row = page.locator('.lib-row').filter({ hasText: title });
      await expect(row.locator('.lib-badge__label')).toHaveText('JSONC');
      await expect(
        page.locator('.lib-row').filter({ hasText: strictName }).locator('.lib-badge__label'),
      ).toHaveText('JSON');
      const filter = page.getByRole('group', { name: 'Filter JSON documents by format' });
      await press(page, filter.getByRole('button', { name: 'JSONC' }));
      await expect(page).toHaveURL(/[?&]format=jsonc/);
      await expect(page.locator('.lib-row').filter({ hasText: strictName })).toHaveCount(0);
      await expect(row).toBeVisible();
      // The copyable curl asks for the row's own media type.
      await row.getByRole('button', { name: `Copy curl command for ${title}` }).click();
      await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible();
      await press(page, row.getByRole('link', { name: title, exact: true }));
      await expect(page).toHaveURL(new RegExp(`/runestone/${slug}$`));
      await expect(formats.getByRole('radio', { name: 'JSONC' })).toBeChecked();

      // Variant: both saved JSONC documents, compared on open — comments are not data.
      await page.goto(`/variant?left=${slug}&right=${twinSlug}`);
      await expect(page.getByText('No differences')).toBeVisible();
      await expect(page.locator('.variant-pane__ok').first()).toContainText('Valid JSONC');
    },
  );
});
