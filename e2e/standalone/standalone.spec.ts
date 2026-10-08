import type { Page } from '@playwright/test';
import { downloadBytes } from '../support/files.js';
import { routes } from '../support/journey.js';
import { makePdf } from '../support/pdf.js';
import { test, expect } from '../support/standalone-fixtures.js';
import { mainNav, navigate, press, typeIntoEditor } from '../support/ui.js';

/**
 * The standalone site (PLAN-35): `client/dist-standalone/` from a static
 * server with the container's rules, and no Bifrost server at all. Every test
 * also runs under the no-request guard (support/standalone-fixtures.ts), so a
 * single request for anything but a file of the build fails it.
 */

const SHEET_TITLE = 'The Bifröst is closed';

function sheet(page: Page) {
  return page.getByRole('alertdialog', { name: SHEET_TITLE });
}

/** Every page the standalone site ships, cold-loaded by the stub-counter check. */
const STANDALONE_PAGES = [
  '/',
  '/ollivanders',
  '/diagon-alley',
  '/diagon-alley/base64',
  '/runestone',
  '/variant',
  '/edda',
  '/groot',
  '/atlas',
  '/loki',
  '/saga',
];

test.describe('standalone shell', () => {
  test(
    'cold-loading every page calls no hub stub and shows no sheet',
    routes('/', '/ollivanders', '/diagon-alley'),
    async ({ page, stubCalls }) => {
      for (const path of STANDALONE_PAGES) {
        await page.goto(path);
        await expect(page.locator('main h1, main h2').first(), path).toBeVisible();
        // Give a stray effect time to fire before counting.
        await page.waitForTimeout(300);
        expect(await stubCalls(page), path).toEqual([]);
        await expect(sheet(page), path).toHaveCount(0);
      }
    },
  );

  test('the nav and hubs carry only what works without a hub', async ({ page }) => {
    await page.goto('/');
    await expect(mainNav(page).getByRole('link')).toHaveText([
      'Midgard',
      'Ollivanders',
      'Diagon Alley',
    ]);
    await expect(page.locator('.shell-footer')).toContainText('build: standalone');
    // The slim Midgard (owner's call): Saga alone, no transfer doors, no Join band.
    await expect(page.getByRole('link', { name: /Saga/ }).first()).toBeVisible();
    for (const door of ['Send files', 'Receive files', 'Hermes', 'Accio']) {
      await expect(page.getByText(door, { exact: true }), door).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'Join Bifrost' })).toHaveCount(0);

    await navigate(page, 'Ollivanders');
    for (const tool of ['Runestone', 'Variant', 'Edda', 'Loki', 'Groot', 'Atlas']) {
      await expect(page.getByRole('link', { name: new RegExp(tool) }).first(), tool).toBeVisible();
    }
    for (const tool of ['Pensieve', 'Brotli']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${tool}`) }), tool).toHaveCount(0);
    }

    await navigate(page, 'Diagon Alley');
    const toolbox = page.getByRole('group', { name: 'Toolbox' });
    await expect(toolbox.getByText('Base64', { exact: true })).toBeVisible();
    for (const tool of ['Nimbus', 'Portkey']) {
      await expect(toolbox.getByText(tool, { exact: true }), tool).toHaveCount(0);
    }
  });

  test('a hub-only deep link shows the sheet as the page, and Okay leads home', async ({
    page,
  }) => {
    for (const path of [
      '/hermes',
      '/pensieve',
      '/upload',
      '/accio',
      '/brotli',
      '/wardens',
      '/go/router',
      '/api/health',
      '/runestone/a-saved-slug',
      '/edda/api/raw/abc',
    ]) {
      await page.goto(path);
      await expect(sheet(page), path).toBeVisible();
      await expect(sheet(page).getByRole('button', { name: 'Try again' }), path).toHaveCount(0);
    }
    await sheet(page).getByRole('button', { name: 'Okay' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a legacy link still lands where it now means', routes('/sigil'), async ({ page }) => {
    await page.goto('/sigil');
    await expect(page).toHaveURL(/\/diagon-alley\/qr$/);
    await expect(page.getByRole('region', { name: 'Make a QR' })).toBeVisible();
  });

  test('an unknown address is still the 404 page', async ({ page }) => {
    await page.goto('/no-such-realm/at/all');
    await expect(page.getByText('404 — off the bridge')).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to Midgard' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('themes switch, and survive a reload, from the bundle', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /open theme picker/ }).click();
    await page.getByRole('menuitemradio', { name: /Daybreak/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'daybreak');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'daybreak');
    await expect(page.getByRole('button', { name: /Theme: Daybreak/ })).toBeVisible();
  });
});

test.describe('standalone features', () => {
  test(
    'Runestone formats in the browser; saving offers the file instead',
    routes('/runestone'),
    async ({ page, stubCalls }) => {
      await page.goto('/runestone');
      await page.getByLabel('Document title').fill('Standalone stone');
      await typeIntoEditor(page, '{"realm":"midgard","bridges":[1,2,3]}');
      await page.getByRole('button', { name: 'Save to Pensieve' }).click();
      await expect(sheet(page)).toBeVisible();
      expect(await stubCalls(page)).toHaveLength(1);

      const [file] = await Promise.all([
        page.waitForEvent('download'),
        sheet(page).getByRole('button', { name: 'Download instead' }).click(),
      ]);
      expect(file.suggestedFilename()).toMatch(/\.json$/);
      expect((await downloadBytes(file)).toString('utf8')).toContain('midgard');
      await expect(sheet(page)).toBeHidden();
    },
  );

  // Tags written out literally so routes.spec.ts can read them as text.
  for (const [kind, content, ext, tags] of [
    ['edda', '# Völuspá\n\nThe seeress speaks of **Yggdrasil**.\n', '.md', routes('/edda')],
    ['groot', 'realm: midgard\nbridges:\n  - bifrost\n', '.yaml', routes('/groot')],
    [
      'atlas',
      '<?xml version="1.0" encoding="UTF-8"?>\n<realms><realm name="midgard"/></realms>\n',
      '.xml',
      routes('/atlas'),
    ],
  ] as const) {
    test(`${kind}: edit, then Download instead of saving`, tags, async ({ page }) => {
      await page.goto(`/${kind}`);
      await page.getByLabel('Document title').fill(`Standalone ${kind}`);
      await typeIntoEditor(page, content);
      await page.getByRole('button', { name: 'Save to Pensieve' }).click();
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        sheet(page).getByRole('button', { name: 'Download instead' }).click(),
      ]);
      expect(file.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
      expect((await downloadBytes(file)).toString('utf8')).toContain(
        kind === 'edda' ? 'Yggdrasil' : 'midgard',
      );
    });
  }

  test('a hub-only hand-off (the Pensieve button) shows the sheet over the page', async ({
    page,
  }) => {
    await page.goto('/runestone');
    await page.getByRole('button', { name: 'Pensieve', exact: true }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page).toHaveURL(/\/runestone$/);
  });

  test('Variant compares two JSON documents', routes('/variant'), async ({ page }) => {
    await page.goto('/variant');
    await typeIntoEditor(page, '{"realm":"midgard","bridges":2}', 0);
    await typeIntoEditor(page, '{"realm":"midgard","bridges":3}', 1);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByLabel('Diff stats')).toBeVisible();
  });

  test('Loki transforms, and Calcifer runs in this browser', routes('/loki'), async ({ page }) => {
    await page.goto('/loki');
    await typeIntoEditor(page, 'console.log("from the hearth"); 6 * 7');
    await expect(page.getByRole('status').filter({ hasText: 'Parses cleanly' })).toBeVisible();
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.locator('.loki-output__body')).toContainText('from the hearth');
    await expect(page.locator('.loki-line--result')).toContainText('42');
  });

  test('the toolbox computes in place', routes('/diagon-alley'), async ({ page }) => {
    await page.goto('/diagon-alley/base64');
    const panel = page.getByRole('region', { name: 'Base64' });
    await panel.getByLabel('Text', { exact: true }).fill('héllo 🌉');
    await expect(panel.getByLabel('Base64', { exact: true })).toHaveValue('aMOpbGxvIPCfjIk=');
  });

  test('Saga presents a dropped PDF', routes('/saga'), async ({ page }) => {
    await page.goto('/saga');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'realms.pdf',
      mimeType: 'application/pdf',
      buffer: makePdf(['Realm one', 'Realm two']),
    });
    const position = page.locator('.saga-footer__position');
    await expect(position).toHaveText('1 / 2');
    await press(page, page.getByRole('button', { name: 'Next slide' }));
    await expect(position).toHaveText('2 / 2');
  });
});

test.describe('standalone Heimdall', () => {
  const sectionNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

  test('opens without a PIN, on device-local sections only', async ({ page, stubCalls }) => {
    await page.goto('/');
    await page.keyboard.press('Shift+Meta+Comma');
    const dialog = page.getByRole('dialog', { name: 'Heimdall' });
    await expect(sectionNav(page)).toBeVisible();
    await expect(dialog.getByLabel('PIN')).toHaveCount(0);
    await expect(dialog.getByText('These settings live in this browser.')).toBeVisible();
    await expect(sectionNav(page).getByRole('button')).toHaveText([
      'Settings',
      'Sky Relics',
      'Loki',
      'Screensaver',
      'About',
    ]);
    await sectionNav(page).getByRole('button', { name: 'About', exact: true }).click();
    await expect(dialog.locator('.about-grid')).toContainText('standalone');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(await stubCalls(page)).toEqual([]);
  });

  test('its settings persist in this browser and reach a second tab', async ({
    page,
    secondTab,
  }) => {
    const other = await secondTab();
    await other.goto('/loki');
    await expect(other.getByRole('button', { name: 'Run' })).toBeVisible();

    await page.goto('/');
    await page.keyboard.press('Shift+Meta+Comma');
    const dialog = page.getByRole('dialog', { name: 'Heimdall' });
    await sectionNav(page).getByRole('button', { name: 'Loki', exact: true }).click();
    const execution = dialog.getByLabel('Enable sandboxed execution');
    await expect(execution).toBeChecked();
    await execution.click();
    await expect(execution).not.toBeChecked();

    // The other tab's Loki follows the storage event: the runner goes away.
    await expect(other.getByRole('button', { name: 'Run' })).toBeHidden();

    await page.reload();
    await page.keyboard.press('Shift+Meta+Comma');
    await sectionNav(page).getByRole('button', { name: 'Loki', exact: true }).click();
    await expect(dialog.getByLabel('Enable sandboxed execution')).not.toBeChecked();
  });

  test('a corrupted stored value costs that field, not the panel', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'bifrost.local.screensaver',
        JSON.stringify({ v: 1, values: { idleSeconds: -4, density: 'high' } }),
      );
      localStorage.setItem('bifrost.local.loki', '{not json');
    });
    await page.reload();
    await page.keyboard.press('Shift+Meta+Comma');
    const dialog = page.getByRole('dialog', { name: 'Heimdall' });
    await sectionNav(page).getByRole('button', { name: 'Screensaver', exact: true }).click();
    await expect(dialog.getByLabel('Particle density')).toHaveValue('high');
    await sectionNav(page).getByRole('button', { name: 'Loki', exact: true }).click();
    await expect(dialog.getByLabel('Enable sandboxed execution')).toBeChecked();
  });
});
