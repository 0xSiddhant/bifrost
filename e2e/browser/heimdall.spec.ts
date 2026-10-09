import { test, expect } from '../support/fixtures.js';
import { Api } from '../support/api.js';
import { routes } from '../support/journey.js';
import { isMobile, waitForLive } from '../support/ui.js';
import type { Locator, Page } from '@playwright/test';

/**
 * Journey 15 — Heimdall: open by shortcut and by taps; a wrong PIN then the
 * right one; settings, themes, History, stats, About/changelog; the
 * screensaver, offline-mode and Loki policies; and a revoke that ends the
 * session on the second device too. Every change here is process-wide (and the
 * revoke ends every session), so it runs on a server of its own.
 */

async function unlock(page: Page, pin: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Heimdall' });
  await dialog.getByLabel('PIN').fill(pin);
  await dialog.getByRole('button', { name: 'Enter' }).click();
  await expect(dialog.getByRole('navigation', { name: 'Sections' })).toBeVisible();
}

/**
 * The policy checkboxes are controlled by the server's answer — they flip when
 * the PATCH returns, not on the click — so click, then wait for the new state.
 */
async function toggle(box: Locator, on: boolean): Promise<void> {
  await box.click();
  if (on) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
}

function section(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: label, exact: true });
}

test(
  'Heimdall: gate, sections, policies, themes and revoke',
  routes('/'),
  async ({ page, ownServer, newDevice }) => {
    test.skip(
      isMobile(page),
      'Heimdall opens only at ≥768px wide, by design (PLAN-10) — no phone entry exists',
    );
    const server = await ownServer();
    const admin = await new Api(server.baseUrl).login(server.pin);

    await page.goto(`${server.baseUrl}/`);
    await waitForLive(page);
    await page.keyboard.press('Shift+Meta+Comma');
    const dialog = page.getByRole('dialog', { name: 'Heimdall' });
    await expect(dialog.getByRole('heading', { name: 'Heimdall' })).toBeVisible();

    await dialog.getByLabel('PIN').fill('0000');
    await dialog.getByRole('button', { name: 'Enter' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await unlock(page, server.pin);

    // Overview (stats) and Activity (the audit history, which holds that failed login).
    await expect(dialog.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await section(page, 'Activity').click();
    await expect(dialog.getByLabel('Filter by event')).toBeVisible();
    await expect(dialog.locator('.heimdall-content__body')).not.toContainText(
      'No activity recorded yet.',
    );
    await section(page, 'About').click();
    await expect(dialog.getByRole('heading', { name: 'Changelog' })).toBeVisible();
    await section(page, 'Storage').click();
    await expect(dialog.locator('.heimdall-content__body')).not.toContainText('Measuring storage…');

    // Policies: each one lands on the server.
    await section(page, 'Loki').click();
    await toggle(dialog.getByLabel('Enable sandboxed execution'), false);
    await expect
      .poll(
        async () =>
          (await admin.get('/api/v1/loki/config')).json<{ executionEnabled: boolean }>()
            .executionEnabled,
      )
      .toBe(false);
    await toggle(dialog.getByLabel('Enable sandboxed execution'), true);

    await section(page, 'Screensaver').click();
    await toggle(dialog.getByLabel('Enable the screensaver'), false);
    await expect
      .poll(
        async () =>
          (await admin.get('/api/v1/screensaver/config')).json<{ enabled: boolean }>().enabled,
      )
      .toBe(false);
    await toggle(dialog.getByLabel('Enable the screensaver'), true);

    await section(page, 'Offline mode').click();
    const firstTarget = dialog
      .getByRole('group', { name: 'Offline targets' })
      .getByRole('checkbox')
      .first();
    await toggle(firstTarget, false);
    await expect
      .poll(
        async () =>
          (await admin.get('/api/v1/offline-mode/config')).json<{ disabled: string[] }>().disabled
            .length,
      )
      .toBe(1);
    await toggle(firstTarget, true);

    // Themes ship with the client since PLAN-35: there is no Themes section to
    // manage any more, and the household default set in Settings reaches a
    // device that has made no choice of its own (criterion 13).
    await expect(section(page, 'Themes')).toHaveCount(0);
    await section(page, 'Settings').click();
    await dialog.getByLabel('Default theme').selectOption('tokyo');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('status')).toBeVisible();
    await dialog.getByRole('button', { name: 'Lock' }).click();
    await expect(dialog).toBeHidden();
    const fresh = await newDevice();
    await fresh.goto(`${server.baseUrl}/`);
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'tokyo');
    await fresh.close();
    await admin.patch('/api/v1/heimdall/settings', { defaultThemeId: null });

    // Settings: a new tap count, then the taps themselves open the gate.
    await page.keyboard.press('Shift+Meta+Comma');
    await unlock(page, server.pin);
    await section(page, 'Settings').click();
    await dialog.getByLabel('Hidden tap count').selectOption('5');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByRole('status')).toBeVisible();
    await dialog.getByRole('button', { name: 'Lock' }).click();
    for (let tap = 0; tap < 5; tap += 1)
      await page.getByRole('link', { name: 'Bifrost', exact: true }).click();
    await expect(dialog.getByLabel('PIN')).toBeVisible();
    await unlock(page, server.pin);

    // Revoke: the other device's open session ends too.
    const deviceB = await newDevice({ baseURL: server.baseUrl });
    await deviceB.goto('/');
    await waitForLive(deviceB);
    await deviceB.keyboard.press('Shift+Meta+Comma');
    await unlock(deviceB, server.pin);
    expect((await deviceB.request.get(`${server.baseUrl}/api/v1/heimdall/session`)).status()).toBe(
      200,
    );

    await section(page, 'Settings').click();
    await dialog.getByRole('button', { name: 'Revoke all sessions' }).click();
    await expect(dialog).toBeHidden();
    expect((await deviceB.request.get(`${server.baseUrl}/api/v1/heimdall/session`)).status()).toBe(
      401,
    );
  },
);
