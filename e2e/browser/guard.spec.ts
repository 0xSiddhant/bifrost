import { test, expect } from '../support/fixtures.js';

/**
 * The net's own proof: each of these bodies passes every assertion, and must
 * still FAIL, because the page did something the user would never see. If the
 * guard stopped catching one of these, `test.fail()` turns that into a red run.
 */
test.describe('the no-silent-errors guard', { tag: '@harness' }, () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'harness self-test: one project is enough',
    );
  });

  test('fails a test on a console.error', async ({ page }) => {
    test.fail();
    await page.goto('/');
    // Runs in the page, which is the point: the guard must see a page's console.
    // eslint-disable-next-line no-console
    await page.evaluate(() => console.error('deliberate'));
    await expect(page.getByRole('heading', { name: /Your devices/ })).toBeVisible();
  });

  test('fails a test on an uncaught page error', async ({ page }) => {
    test.fail();
    await page.goto('/');
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('deliberate');
      }, 0),
    );
    await page.waitForTimeout(200);
  });

  test('fails and blocks a request to a non-loopback host', async ({ page }) => {
    test.fail();
    await page.goto('/');
    await page.evaluate(() => fetch('https://example.com/').catch(() => undefined));
    await page.waitForTimeout(200);
  });

  test('fails a test on a refused request', async ({ page }) => {
    test.fail();
    await page.goto('/');
    await page.evaluate(() => fetch('http://127.0.0.1:9/').catch(() => undefined));
    await page.waitForTimeout(500);
  });

  test('passes a clean page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your devices/ })).toBeVisible();
  });
});
