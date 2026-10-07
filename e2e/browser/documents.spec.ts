import { test, expect } from '../support/fixtures.js';
import { downloadBytes } from '../support/files.js';
import { routes } from '../support/journey.js';
import {
  acceptNextDialog,
  editorText,
  isMobile,
  press,
  showCode,
  typeIntoEditor,
} from '../support/ui.js';
import type { Page } from '@playwright/test';

/**
 * Journey 5 — Runestone, Edda, Groot and Atlas, each: create, edit, save,
 * reload by slug, rename (the old slug then lands on the new one), the raw
 * `API` link and "Copy curl" on the Pensieve, export, delete, and the size-cap
 * message. Then each kind's own speciality.
 */

interface Kind {
  kind: 'runestone' | 'edda' | 'groot' | 'atlas';
  label: string;
  /** The toast a first save raises. */
  created: string;
  content: string;
  /** A line of `content` that must survive the round trip. */
  marker: string;
  mime: string;
  ext: string;
  /** The export control's accessible name. */
  exportButton: string;
  /** Written out literally so routes.spec.ts can read them as text. */
  editorRoutes: { tag: string[] };
}

const KINDS: Kind[] = [
  {
    kind: 'runestone',
    editorRoutes: routes('/runestone', '/runestone/:slug'),
    label: 'Runestone',
    created: 'Runestone carved',
    content: '{"realm":"midgard","bridges":[1,2,3],"note":"ᚱᚢᚾᛖ"}',
    marker: 'midgard',
    mime: 'application/json',
    ext: '.json',
    exportButton: 'Export',
  },
  {
    kind: 'edda',
    editorRoutes: routes('/edda', '/edda/:slug'),
    label: 'Edda',
    created: 'Edda saved',
    content: '# Völuspá\n\nThe seeress speaks of **Yggdrasil**.\n',
    marker: 'Yggdrasil',
    mime: 'text/markdown',
    ext: '.md',
    exportButton: '.md',
  },
  {
    kind: 'groot',
    editorRoutes: routes('/groot', '/groot/:slug'),
    label: 'Groot',
    created: 'Grown into the Pensieve',
    content: 'realm: midgard\nbridges:\n  - bifrost\n  - gjallarbru\n',
    marker: 'gjallarbru',
    mime: 'application/yaml',
    ext: '.yaml',
    exportButton: 'Export',
  },
  {
    kind: 'atlas',
    editorRoutes: routes('/atlas', '/atlas/:slug'),
    label: 'Atlas',
    created: 'Charted into the Pensieve',
    content: '<?xml version="1.0" encoding="UTF-8"?>\n<realms><realm name="midgard"/></realms>\n',
    marker: 'midgard',
    mime: 'application/xml',
    ext: '.xml',
    exportButton: 'Export',
  },
];

/** A valid document of each kind, padded to `bytes` bytes of ASCII. */
function bigDocument(kind: Kind['kind'], bytes: number): string {
  const wrap: Record<Kind['kind'], [string, string]> = {
    runestone: ['{"pad":"', '"}'],
    edda: ['# Big\n\n', '\n'],
    groot: ['pad: ', '\n'],
    atlas: ['<?xml version="1.0" encoding="UTF-8"?>\n<pad>', '</pad>\n'],
  };
  const [head, tail] = wrap[kind];
  return `${head}${'x'.repeat(bytes - head.length - tail.length)}${tail}`;
}

function slugFrom(page: Page, kind: string): string {
  return new URL(page.url()).pathname.replace(`/${kind}/`, '');
}

/**
 * Bring the code editor on screen. On a phone Edda opens a saved document in
 * Preview; the editor is a tap away, as it is for a person.
 */
async function showEditor(page: Page, kind: Kind): Promise<void> {
  if (kind.kind === 'edda') {
    if (isMobile(page)) {
      await press(
        page,
        page.getByRole('group', { name: 'Pane' }).getByRole('button', { name: 'Edit' }),
      );
    }
    return;
  }
  await showCode(page);
}

for (const kind of KINDS) {
  test.describe(kind.label, () => {
    test(
      'create → save → reload by slug → rename → stale slug → export',
      kind.editorRoutes,
      async ({ page }) => {
        const stamp = Date.now().toString(36);
        const title = `E2E ${kind.label} ${stamp}`;
        await page.goto(`/${kind.kind}`);
        await page.getByLabel('Document title').fill(title);
        await showEditor(page, kind);
        await typeIntoEditor(page, kind.content);
        await page.getByRole('button', { name: 'Save to Pensieve' }).click();
        await expect(page.getByRole('status').filter({ hasText: kind.created })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${kind.kind}/[a-z0-9-]+$`));
        const firstSlug = slugFrom(page, kind.kind);
        await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();

        await page.reload();
        await expect(page.getByLabel('Document title')).toHaveValue(title);
        await showEditor(page, kind);
        await expect(editorText(page)).toContainText(kind.marker);

        // Renaming regenerates the slug; the old one still finds the document.
        await page.getByLabel('Document title').fill(`${title} renamed`);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
        await expect(page).not.toHaveURL(new RegExp(`/${firstSlug}$`));
        const newSlug = slugFrom(page, kind.kind);
        expect(newSlug).toContain('renamed');
        await page.goto(`/${kind.kind}/${firstSlug}`);
        await expect(page).toHaveURL(new RegExp(`/${kind.kind}/${newSlug}$`));
        await expect(page.getByLabel('Document title')).toHaveValue(`${title} renamed`);

        await showEditor(page, kind);
        const [file] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('button', { name: kind.exportButton, exact: true }).click(),
        ]);
        expect(file.suggestedFilename()).toMatch(new RegExp(`\\${kind.ext}$`));
        expect((await downloadBytes(file)).toString('utf8')).toContain(kind.marker);
      },
    );

    test(
      'on the Pensieve: raw API link, copy curl, delete',
      routes('/pensieve'),
      async ({ page, server }) => {
        const name = `E2E pensieve ${kind.kind} ${Date.now().toString(36)}`;
        const created = await page.request.post(`${server.baseUrl}/api/${kind.kind}`, {
          data: { name, content: kind.content },
        });
        expect(created.status()).toBe(201);

        await page.goto(`/pensieve?type=${kind.kind}`);
        const row = page.locator('.lib-row').filter({ hasText: name });
        await expect(row).toBeVisible();

        const api = row.getByRole('link', { name: `Open ${name} as raw data` });
        const href = await api.getAttribute('href');
        expect(href).toMatch(new RegExp(`^/${kind.kind}/api/`));
        const raw = await page.request.get(`${server.baseUrl}${href}`);
        expect(raw.headers()['content-type']).toContain(kind.mime);
        expect(raw.headers()['access-control-allow-origin']).toBe('*');
        expect(await raw.text()).toBe(kind.content);

        await row.getByRole('button', { name: `Copy curl command for ${name}` }).click();
        await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible();

        acceptNextDialog(page);
        await row.getByRole('button', { name: `Delete ${name}` }).click();
        await expect(row).toBeHidden();
        const gone = await page.request.get(`${server.baseUrl}${href}`, { maxRedirects: 0 });
        expect(gone.status()).toBe(404);
      },
    );

    test(
      'a 1.5 MB document, imported from a file, saves whole',
      kind.editorRoutes,
      async ({ page, server }) => {
        // Over Fastify's default 1 MiB body limit and under the 2048 KB cap:
        // refused with a 413 until PLAN-33 sized the route's limit from the cap.
        // The server answers in milliseconds; the time goes on the page laying
        // out 1.5 MB, which CI's software-rendered WebKit does far slower.
        test.slow();
        await page.goto(`/${kind.kind}`);
        await page
          .getByLabel('Document title')
          .fill(`E2E big ${kind.kind} ${Date.now().toString(36)}`);
        const big = bigDocument(kind.kind, 1_500_000);
        await page.locator(`input[type="file"][accept*="${kind.ext}"]`).setInputFiles({
          name: `big${kind.ext}`,
          mimeType: kind.mime,
          buffer: Buffer.from(big),
        });
        // Lasting state only, never the toast: while the page lays out 1.5 MB
        // the toast can come and go before a poll sees it. The save's own
        // answer comes first, so a refusal fails here by its status.
        const saved = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `/api/${kind.kind}`,
          { timeout: 60_000 },
        );
        await page.getByRole('button', { name: 'Save to Pensieve' }).click();
        expect((await saved).status()).toBe(201);
        await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled({
          timeout: 60_000,
        });
        await expect(page).toHaveURL(new RegExp(`/${kind.kind}/[a-z0-9-]+$`));
        const raw = await page.request.get(
          `${server.baseUrl}/${kind.kind}/api/${slugFrom(page, kind.kind)}`,
        );
        expect(raw.status()).toBe(200);
        expect((await raw.body()).length).toBe(Buffer.byteLength(big));
      },
    );

    test(
      'a file over the size cap is refused with a message',
      kind.editorRoutes,
      async ({ page }) => {
        // Picked straight after load, on purpose: an import made before the
        // cap arrived used to skip the check (fixed after PLAN-32a).
        await page.goto(`/${kind.kind}`);
        const big =
          kind.kind === 'runestone'
            ? `{"pad":"${'x'.repeat(2100 * 1024)}"}`
            : 'x'.repeat(2100 * 1024);
        await page.locator(`input[type="file"][accept*="${kind.ext}"]`).setInputFiles({
          name: `huge${kind.ext}`,
          mimeType: kind.mime,
          buffer: Buffer.from(big),
        });
        await expect(
          page.getByRole('status').filter({ hasText: /That file is over the 2\.0 MB limit\./ }),
        ).toBeVisible();
      },
    );
  });
}
