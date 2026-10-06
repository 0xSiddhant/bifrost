import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../support/fixtures.js';
import { cliHome, runCli, type CliHome } from '../support/cli-install.js';
import { routes } from '../support/journey.js';
import { typeIntoEditor, waitForLive } from '../support/ui.js';

/**
 * Cross-surface journeys: the installed CLI only triggers, and the assertion
 * is what a browser shows. The binary comes from the run's global setup.
 */

let home: CliHome;
test.beforeEach(() => {
  home = cliHome(process.env.E2E_BIFROST_VERSION ?? '0.0.0');
});
test.afterEach(() => home.remove());

function bifrost(baseUrl: string, args: string[]) {
  const binary = process.env.E2E_BIFROST_BINARY;
  if (!binary) throw new Error('E2E_BIFROST_BINARY unset — browser/global-setup.ts did not run');
  return runCli(binary, ['--host', baseUrl, ...args], { env: home.env });
}

test.describe('cross-surface', () => {
  test(
    'bifrost push -d → the browser’s Downloads shows the folder live',
    routes('/downloads'),
    async ({ page, server }) => {
      const folder = `FromCli${Date.now().toString(36)}`;
      await page.goto('/downloads');
      await waitForLive(page);
      fs.writeFileSync(path.join(home.dir, 'log.txt'), 'pushed from a terminal');
      const run = await bifrost(server.baseUrl, [
        'push',
        path.join(home.dir, 'log.txt'),
        '-d',
        folder,
      ]);
      expect(run.code, run.stderr).toBe(0);
      await expect(page.getByRole('status').filter({ hasText: `in ${folder}` })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(folder) }).first()).toBeVisible();
    },
  );

  test(
    'a browser-saved edda → bifrost preview → the page it names renders',
    routes('/edda', '/edda/preview/:slug'),
    async ({ page, server }) => {
      await page.goto('/edda');
      await page.getByLabel('Document title').fill(`Cross ${Date.now().toString(36)}`);
      await typeIntoEditor(page, '# From the browser\n\nand back again.\n');
      await page.getByRole('button', { name: 'Save to Pensieve' }).click();
      await expect(page).toHaveURL(/\/edda\/[a-z0-9-]+$/);
      const slug = new URL(page.url()).pathname.split('/').pop() ?? '';

      const run = await bifrost(server.baseUrl, ['preview', slug, '--no-open']);
      expect(run.code, run.stderr).toBe(0);
      const url = run.stdout.trim().split('\n').pop() ?? '';
      expect(url).toBe(`${server.baseUrl}/edda/preview/${slug}`);
      await page.goto(url);
      await expect(
        page.locator('.md-preview--read').getByRole('heading', { name: 'From the browser' }),
      ).toBeVisible();
    },
  );

  test(
    'bifrost clip → Hermes on another device, live',
    routes('/hermes'),
    async ({ server, newDevice }) => {
      const text = `from the terminal ${Date.now().toString(36)}`;
      const deviceB = await newDevice();
      await deviceB.goto('/hermes');
      await waitForLive(deviceB);
      const run = await bifrost(server.baseUrl, ['clip', text]);
      expect(run.code, run.stderr).toBe(0);
      await expect(deviceB.locator('.clip-entry').filter({ hasText: text })).toBeVisible();
    },
  );

  test(
    'bifrost portkey create → the go-link resolves in the browser',
    routes('/portkey'),
    async ({ page, server }) => {
      const slug = `cli-${Date.now().toString(36)}`;
      const run = await bifrost(server.baseUrl, [
        'portkey',
        'create',
        slug,
        `${server.baseUrl}/wardens`,
      ]);
      expect(run.code, run.stderr).toBe(0);
      await page.goto(`/go/${slug}`);
      await expect(page).toHaveURL(/\/wardens$/);
      await expect(page.getByRole('heading', { name: 'Wardens' })).toBeVisible();
    },
  );
});
