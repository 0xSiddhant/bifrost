import { test, expect } from '../support/fixtures.js';
import { downloadBytes } from '../support/files.js';
import { routes } from '../support/journey.js';
import { typeIntoEditor } from '../support/ui.js';

/** Journey 7 — Variant: a JSON and a text compare, each export downloaded and parsed. */

test.describe('variant', () => {
  test('a JSON compare exports a valid RFC 6902 patch', routes('/variant'), async ({ page }) => {
    await page.goto('/variant');
    await typeIntoEditor(page, '{"realm":"midgard","bridges":2}', 0);
    await typeIntoEditor(page, '{"realm":"midgard","bridges":3,"guard":"heimdall"}', 1);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByLabel('Diff stats')).toBeVisible();

    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export as JSON Patch' }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/\.patch\.json$/);
    const patch = JSON.parse((await downloadBytes(file)).toString('utf8')) as {
      op: string;
      path: string;
      value?: unknown;
    }[];
    expect(patch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'replace', path: '/bridges', value: 3 }),
        expect.objectContaining({ op: 'add', path: '/guard', value: 'heimdall' }),
      ]),
    );
  });

  test('a text compare exports a git-shaped unified diff', routes('/variant'), async ({ page }) => {
    await page.goto('/variant');
    await page
      .getByRole('group', { name: 'Compare mode' })
      .getByRole('button', { name: 'Text' })
      .click();
    await typeIntoEditor(page, 'alpha\nbeta\ndelta\n', 0);
    await typeIntoEditor(page, 'alpha\ngamma\ndelta\n', 1);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export as unified diff' }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/\.patch$/);
    const diff = (await downloadBytes(file)).toString('utf8');
    expect(diff).toMatch(/^--- /m);
    expect(diff).toMatch(/^\+\+\+ /m);
    expect(diff).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m);
    expect(diff).toMatch(/^-beta$/m);
    expect(diff).toMatch(/^\+gamma$/m);
  });
});
