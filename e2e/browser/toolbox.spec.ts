import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import type { Locator, Page } from '@playwright/test';

/**
 * Journey 13 — Diagon Alley: each of the 13 toolbox tools opens in place and
 * computes one known sample. Pure client compute, so every expected value is
 * fixed by its standard (RFC 4648 Base64, FIPS 180-4 SHA-256, …).
 */

async function openTool(page: Page, id: string, title: string): Promise<Locator> {
  await page.goto(`/diagon-alley/${id}`);
  const panel = page.getByRole('region', { name: title });
  await expect(panel).toBeVisible();
  return panel;
}

function row(panel: Locator, label: string): Locator {
  return panel
    .locator('.tool-rows__row')
    .filter({ has: panel.page().getByText(label, { exact: true }) })
    .locator('dd');
}

test.describe('toolbox', () => {
  test(
    'a card opens its tool in place, and Close puts it away',
    routes('/diagon-alley', '/diagon-alley/:toolId'),
    async ({ page }) => {
      await page.goto('/diagon-alley');
      await page
        .getByRole('group', { name: 'Toolbox' })
        .getByText('Base64', { exact: true })
        .click();
      await expect(page).toHaveURL(/\/diagon-alley\/base64$/);
      await expect(page.getByRole('region', { name: 'Base64' })).toBeVisible();
      await page.getByRole('button', { name: 'Close Base64' }).click();
      await expect(page).toHaveURL(/\/diagon-alley$/);
      await expect(page.getByRole('region', { name: 'Base64' })).toBeHidden();
    },
  );

  test('Make a QR', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'qr', 'Make a QR');
    await panel.getByLabel('Text or URL').fill('http://bifrost.local:4646/go/router');
    await expect(panel.locator('.tool-qr__value')).toHaveText(
      'http://bifrost.local:4646/go/router',
    );
    await expect(panel.getByRole('img')).toBeVisible();
  });

  test('Base64', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'base64', 'Base64');
    await panel.getByLabel('Text', { exact: true }).fill('héllo 🌉');
    await expect(panel.getByLabel('Base64', { exact: true })).toHaveValue('aMOpbGxvIPCfjIk=');
  });

  test('UUID', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'uuid', 'UUID');
    const first = panel
      .getByRole('list', { name: 'Generated UUIDs' })
      .getByRole('listitem')
      .first();
    await expect(first).toHaveText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test('Epoch', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'epoch', 'Epoch');
    await panel.getByLabel('Unix timestamp').fill('1700000000');
    await expect(panel.locator('.tool-rows')).toContainText('2023-11-14');
  });

  test('URL', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'url', 'URL');
    await panel.getByLabel('Text', { exact: true }).fill('a b&c=d');
    await expect(panel.getByLabel('Encoded', { exact: true })).toHaveValue('a%20b%26c%3Dd');
    await panel
      .getByLabel('Take a URL apart')
      .fill('https://bifrost.local:4646/go/router?realm=midgard#top');
    await expect(panel.getByLabel('Parameter 1 value')).toHaveValue('midgard');
  });

  test('ASCII / Hex / Binary', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'bytes', 'ASCII / Hex / Binary');
    await panel.getByLabel('Text', { exact: true }).fill('Hi');
    await expect(panel.locator('textarea').nth(1)).toHaveValue(/48 69/i);
    await panel.getByLabel('Convert a number').fill('255');
    await expect(panel).toContainText('11111111');
  });

  test('JWT', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'odin', realm: 'asgard' })}.c2lnbmF0dXJl`;
    const panel = await openTool(page, 'jwt', 'JWT');
    await panel.getByLabel('Token').fill(token);
    await expect(panel).toContainText('alg: HS256');
    await expect(panel.locator('pre.tool-code').nth(1)).toContainText('"realm": "asgard"');
  });

  test('Iris', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'iris', 'Iris');
    await panel.locator('#iris-colour').fill('#5eead4');
    await expect(row(panel, 'Hex')).toHaveText(/#5eead4/i);
    await expect(row(panel, 'RGB')).toContainText('94');
    await panel.getByLabel('Foreground').fill('#000000');
    await panel.getByLabel('Background').fill('#ffffff');
    await expect(panel).toContainText('21');
  });

  test('CIDR', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'cidr', 'CIDR');
    await panel.getByLabel('Block').fill('192.168.1.0/24');
    await expect(row(panel, 'Broadcast')).toHaveText('192.168.1.255');
    await expect(row(panel, 'Usable hosts')).toHaveText('254');
    await panel.getByLabel('Is this address inside?').fill('192.168.1.33');
    await expect(panel.getByRole('status')).toContainText(/inside/i);
  });

  test('Case', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'case', 'Case');
    await panel.getByLabel('Text').fill('httpResponseCode');
    await expect(panel.locator('.tool-rows')).toContainText('http_response_code');
    await expect(panel.locator('.tool-rows')).toContainText('HTTP_RESPONSE_CODE');
    await expect(panel.locator('.tool-rows')).toContainText('http-response-code');
  });

  test('Password', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'secret', 'Password');
    await panel.getByLabel('Length').fill('32');
    await expect(panel.locator('output.tool-secret')).toHaveText(/^\S{32}$/);
    await expect(panel).toContainText('bits');
  });

  test('Cron', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'cron', 'Cron');
    await panel.getByLabel('Expression').fill('*/15 * * * *');
    await expect(panel.locator('.tool-output .tool-list li')).toHaveCount(5);
  });

  test('SHA-256', routes('/diagon-alley/:toolId'), async ({ page }) => {
    const panel = await openTool(page, 'hash', 'SHA-256');
    await panel.getByLabel('Text').fill('abc');
    await expect(panel.locator('output.tool-secret')).toHaveText(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
