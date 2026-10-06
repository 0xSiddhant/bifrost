import { test, expect } from '../support/fixtures.js';
import { Api, saveDocument } from '../support/api.js';
import { routes } from '../support/journey.js';
import { editorText, isMobile, press, showCode, typeIntoEditor } from '../support/ui.js';

/**
 * Journey 5, each kind's own speciality: Edda's live preview, Mermaid and
 * public preview page; Atlas's plist table edit round trip; Runestone's tree;
 * Groot's advisory rail.
 */

const MANUSCRIPT = [
  '# The Bridge',
  '',
  'Heimdall keeps **watch**.',
  '',
  '```mermaid',
  'graph LR',
  '  Midgard --> Asgard',
  '```',
  '',
].join('\n');

test(
  'Edda: live preview, a Mermaid diagram, and the public preview page',
  routes('/edda', '/edda/preview/:slug'),
  async ({ page }) => {
    await page.goto('/edda');
    await page.getByLabel('Document title').fill(`E2E manuscript ${Date.now().toString(36)}`);
    await typeIntoEditor(page, MANUSCRIPT);
    if (isMobile(page))
      await press(
        page,
        page.getByRole('group', { name: 'Pane' }).getByRole('button', { name: 'Preview' }),
      );
    const preview = page.locator('.md-preview').filter({ visible: true }).first();
    await expect(preview.getByRole('heading', { name: 'The Bridge' })).toBeVisible();
    await expect(preview.locator('strong', { hasText: 'watch' })).toBeVisible();
    await expect(preview.locator('figure.mermaid svg')).toBeVisible();

    await page.getByRole('button', { name: 'Save to Pensieve' }).click();
    await expect(page).toHaveURL(/\/edda\/[a-z0-9-]+$/);
    const slug = new URL(page.url()).pathname.split('/').pop() ?? '';

    await page.goto(`/edda/preview/${slug}`);
    await expect(page.locator('h1.edda-read__title')).toContainText('E2E manuscript');
    await expect(
      page.locator('.md-preview--read').getByRole('heading', { name: 'The Bridge' }),
    ).toBeVisible();
    // The contents column is a desktop affordance; a phone reads straight down.
    if (!isMobile(page))
      await expect(page.getByRole('navigation', { name: 'Contents' })).toContainText('The Bridge');
    await expect(page.locator('.md-preview--read figure.mermaid svg')).toBeVisible();
    await page.getByRole('button', { name: 'Open in editor' }).click();
    await expect(page).toHaveURL(new RegExp(`/edda/${slug}$`));
  },
);

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Name</key>
\t<string>Bifrost</string>
\t<key>Port</key>
\t<integer>4646</integer>
</dict>
</plist>
`;

test(
  'Atlas: a plist table edit lands in the code and survives a save',
  routes('/atlas/:slug'),
  async ({ page, server }) => {
    // On a phone the table pane replaces the code pane: the edit must still
    // land (it was silently dropped until the PLAN-32a fixes).
    const doc = await saveDocument(
      new Api(server.baseUrl),
      'atlas',
      PLIST,
      `E2E plist ${Date.now().toString(36)}`,
    );
    await page.goto(`/atlas/${doc.slug}`);
    if (isMobile(page))
      await press(
        page,
        page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Table' }),
      );

    const table = page.getByRole('table', { name: 'Property list' });
    const value = table.locator('input[aria-label="Value"][value="Bifrost"]');
    await value.fill('Asgard');
    // The draft re-renders the input's value attribute, so find it by its new one.
    await table.locator('input[aria-label="Value"][value="Asgard"]').press('Enter');

    if (isMobile(page))
      await press(
        page,
        page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Code' }),
      );
    await expect(editorText(page)).toContainText('<string>Asgard</string>');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    const raw = await page.request.get(`${server.baseUrl}/atlas/api/${doc.slug}`);
    // Only the edited value's bytes changed — the surgical-edit promise.
    expect(await raw.text()).toBe(
      PLIST.replace('<string>Bifrost</string>', '<string>Asgard</string>'),
    );
  },
);

test(
  'Runestone: the tree view shows the parsed document',
  routes('/runestone'),
  async ({ page }) => {
    await page.goto('/runestone');
    await showCode(page);
    await typeIntoEditor(page, '{"realm":{"name":"midgard","bridges":["bifrost"]}}');
    await expect(page.getByText('Valid JSON')).toBeVisible();
    await press(
      page,
      page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Tree' }),
    );
    await expect(page.locator('.rune-body')).toContainText('bridges');
    await expect(page.locator('.rune-body')).toContainText('midgard');
  },
);

test(
  'Groot: the Norway problem is flagged but never blocks a save',
  routes('/groot'),
  async ({ page }) => {
    await page.goto('/groot');
    await showCode(page);
    await typeIntoEditor(page, 'country: no\nversion: 1.10\n');
    const rail = page.getByRole('region', { name: 'Advisories' });
    await expect(rail).toContainText('line 1');
    await expect(rail).toContainText('line 2');
    await expect(page.getByRole('button', { name: 'Save to Pensieve' })).toBeEnabled();
  },
);
