import { test, expect } from '../support/fixtures.js';

/**
 * The API docs (PLAN-38), on the API server's own loopback port, never the
 * web host's. The usual guard runs over the page: a request to any external
 * host, a refused request, or a console error (a CSP violation logs one)
 * fails the test (criterion 3). "Try it out" is offered for every method,
 * under the real-data note (criterion 4).
 */

interface Spec {
  tags: { name: string }[];
}

test.describe('API docs', { tag: '@api-docs' }, () => {
  test('render every module, with the real-data note first', async ({ page, server }) => {
    const spec = (await (await page.request.get(`${server.apiUrl}/docs/json`)).json()) as Spec;
    expect(spec.tags.length).toBeGreaterThan(15);

    await page.goto(`${server.apiUrl}/docs`);
    await expect(page.locator('.information-container')).toContainText(
      '"Try it out" sends real requests to this hub; writes change real data.',
    );
    for (const { name } of spec.tags) {
      await expect(page.locator(`.opblock-tag[data-tag="${name}"]`), name).toBeVisible();
    }
  });

  test('"Try it out" runs a read against the live hub', async ({ page, server }) => {
    await page.goto(`${server.apiUrl}/docs#/health/getHealth`);
    const operation = page.locator('#operations-health-getHealth');
    await expect(operation).toHaveClass(/is-open/);
    await operation.getByRole('button', { name: 'Try it out' }).click();
    await operation.getByRole('button', { name: 'Execute' }).click();
    const live = operation.locator('.live-responses-table');
    await expect(live.locator('tbody .response-col_status').first()).toHaveText('200');
    await expect(live).toContainText('"ok": true');
  });

  test('offers "Try it out" on a write too, at the merged document path', async ({
    page,
    server,
  }) => {
    for (const [tag, id] of [
      ['clipboard', 'addClipboardEntry'],
      ['runestone', 'updateRunestone'],
    ] as const) {
      // A hash-only change is not a navigation, and Swagger UI reads the deep
      // link once, on load: load each one fresh.
      await page.goto(`${server.apiUrl}/docs#/${tag}/${id}`);
      await page.reload();
      const operation = page.locator(`#operations-${tag}-${id}`);
      await expect(operation).toHaveClass(/is-open/);
      await expect(operation.getByRole('button', { name: 'Try it out' })).toBeVisible();
    }
    await expect(page.locator('#operations-runestone-updateRunestone')).toContainText(
      '/api/v1/runestone/{key}',
    );
  });
});
