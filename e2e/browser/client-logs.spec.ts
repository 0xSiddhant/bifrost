import fs from 'node:fs';
import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';

/**
 * Journey 18 — client logs: an error thrown in the page lands in the server's
 * own log file, beside the server's lines, tagged `source: "client"`.
 */
test(
  'an uncaught page error reaches the server log as a client line',
  routes('/'),
  async ({ page, server, guard }) => {
    const marker = `e2e-client-error-${Date.now().toString(36)}`;
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your devices/ })).toBeVisible();

    // The one page error this suite throws on purpose: the guard looks away for it.
    guard.pause();
    const thrown = page.waitForEvent('pageerror');
    await page.evaluate((message) => {
      setTimeout(() => {
        throw new Error(message);
      }, 0);
    }, marker);
    await thrown;
    guard.resume();

    // The client batches its reports (a short flush delay), so wait for the line.
    let line = '';
    await expect
      .poll(
        () => {
          line =
            fs
              .readFileSync(server.logFile, 'utf8')
              .split('\n')
              .find((entry) => entry.includes(marker)) ?? '';
          return line;
        },
        { timeout: 15_000 },
      )
      .not.toBe('');
    const record = JSON.parse(line) as { source?: string; logLevel?: string };
    expect(record.source).toBe('client');
    expect(['error', 'warn']).toContain(record.logLevel);
  },
);
