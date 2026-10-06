import { test, expect } from '../support/fixtures.js';
import { mainNav } from '../support/ui.js';

/**
 * The `cloud` project boots a `DEPLOY_PROFILE=cloud` server (playwright.config
 * sets `profile`) and asserts the local-only modules are absent from the UI and
 * their APIs are not served — the deployment manifest, seen from outside.
 */

const LOCAL_ONLY_APIS = [
  '/api/files/config',
  '/api/downloads',
  '/api/clipboard',
  '/api/presence',
  '/api/heimdall/audit',
  '/api/accio',
  '/api/nimbus/config',
  '/api/portkey',
];

test('capabilities name the cloud module set', async ({ request, server }) => {
  const response = await request.get(`${server.baseUrl}/api/capabilities`);
  const body = (await response.json()) as { profile: string; modules: string[] };
  expect(body.profile).toBe('cloud');
  for (const local of [
    'file-transfer',
    'previews',
    'clipboard',
    'presence',
    'audit-log',
    'accio',
    'nimbus',
    'portkey',
  ]) {
    expect(body.modules).not.toContain(local);
  }
  for (const both of [
    'runestone',
    'edda',
    'groot',
    'atlas',
    'variant',
    'loki',
    'brotli',
    'toolbox',
    'saga',
  ]) {
    expect(body.modules).toContain(both);
  }
});

test('local-only APIs are not served', async ({ request, server }) => {
  for (const path of LOCAL_ONLY_APIS) {
    const response = await request.get(`${server.baseUrl}${path}`);
    expect(response.status(), path).toBe(404);
  }
});

test('the nav and hubs show only what this profile serves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.shell-footer')).toContainText('profile: cloud');
  await expect(mainNav(page).getByRole('link')).toHaveText([
    'Midgard',
    'Ollivanders',
    'Diagon Alley',
  ]);
  await expect(page.getByRole('link', { name: /Accio/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Saga/ })).toBeVisible();

  await page.goto('/diagon-alley');
  const toolbox = page.getByRole('group', { name: 'Toolbox' });
  await expect(toolbox.getByText('Base64', { exact: true })).toBeVisible();
  await expect(toolbox.getByText('Nimbus', { exact: true })).toHaveCount(0);
  await expect(toolbox.getByText('Portkey', { exact: true })).toHaveCount(0);

  await page.goto('/ollivanders');
  for (const tool of [
    'Runestone',
    'Edda',
    'Groot',
    'Atlas',
    'Variant',
    'Loki',
    'Brotli',
    'Pensieve',
  ]) {
    await expect(page.getByRole('link', { name: new RegExp(tool) }).first()).toBeVisible();
  }
});

test('Loki offers no sandboxed run in the cloud profile', async ({ page }) => {
  await page.goto('/loki');
  await expect(page.getByRole('heading', { name: /Loki/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toHaveCount(0);
});

test('Midgard hides the transfer doors whose modules this profile does not serve', async ({
  page,
}) => {
  // Found by this suite (PLAN-32a): these three carried no module gate.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your devices/ })).toBeVisible();
  for (const door of ['Send files', 'Receive files', 'Hermes']) {
    await expect(page.getByText(door, { exact: true }), door).toHaveCount(0, { timeout: 2_000 });
  }
});
