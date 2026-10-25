import { test, expect } from '../support/fixtures.js';
import { downloadBytes, textFile, zipEntryNames } from '../support/files.js';
import { routes } from '../support/journey.js';
import { press, waitForLive } from '../support/ui.js';

/**
 * Journey 2 — transfer: upload → staging → preview → rename (with the
 * sanitizer's suggested name) → publish → Downloads → download; a folder
 * upload → folder view → .zip; device B sees each published step live.
 */

test.describe('transfer', () => {
  test(
    'a staged file is previewed, renamed, published and downloaded on another device',
    routes('/upload', '/upload/:name/preview', '/downloads', '/downloads/:id/preview'),
    async ({ page, newDevice }) => {
      const stamp = Date.now().toString(36);
      const original = `notes-${stamp}.txt`;
      const body = `hello across the bridge ${stamp}\n`;

      const deviceB = await newDevice();
      await deviceB.goto('/downloads');
      await expect(deviceB.getByRole('heading', { name: 'Receive files' })).toBeVisible();
      await waitForLive(deviceB);

      await page.goto('/upload');
      await waitForLive(page);
      await page.locator('input[type="file"]').setInputFiles(textFile(original, body));
      await expect(page.getByRole('button', { name: `Rename ${original}` })).toBeVisible();

      // Preview the staged file before anyone else can see it.
      await page.getByRole('link', { name: `Preview ${original}` }).click();
      const preview = page.getByRole('dialog', { name: `Preview of ${original}` });
      await expect(preview).toContainText(body.trim());
      await page.getByRole('button', { name: 'Close preview' }).click();
      await expect(preview).toBeHidden();
      await expect(page).toHaveURL(/\/upload$/);

      // A name the sanitizer would change is refused with the clean name offered.
      await page.getByRole('button', { name: `Rename ${original}` }).click();
      const rename = page.getByRole('dialog', { name: 'Rename file' });
      await rename.getByLabel('New name').fill(`reports/${stamp}.txt`);
      await rename.getByRole('button', { name: 'Save' }).click();
      await expect(rename.getByRole('alert')).toBeVisible();
      const useSuggestion = rename.getByRole('button', { name: /^Use “/ });
      const suggested = (await useSuggestion.textContent())?.replace(/^Use “|”$/g, '') ?? '';
      expect(suggested).toContain(stamp);
      expect(suggested).toBe(`reports_${stamp}.txt`);
      await useSuggestion.click();
      await expect(rename).toBeHidden();
      await expect(page.getByRole('button', { name: `Rename ${suggested}` })).toBeVisible();

      // Publish: the sender sees it leave, the other device is told and lists it.
      await page.getByRole('button', { name: /Move/ }).click();
      await expect(page.getByText('moved')).toBeVisible();
      await expect(
        deviceB.getByRole('status').filter({ hasText: `${suggested} is ready in Receive` }),
      ).toBeVisible();
      const download = deviceB.getByRole('link', { name: `Download ${suggested}` });
      await expect(download).toBeVisible();

      await deviceB.getByRole('link', { name: `Preview ${suggested}` }).click();
      await expect(deviceB).toHaveURL(/\/downloads\/[^/]+\/preview$/);
      await expect(deviceB.getByRole('dialog')).toContainText(body.trim());
      await deviceB.goBack();
      await expect(deviceB).toHaveURL(/\/downloads$/);

      const [file] = await Promise.all([deviceB.waitForEvent('download'), download.click()]);
      expect(file.suggestedFilename()).toBe(suggested);
      expect((await downloadBytes(file)).toString('utf8')).toBe(body);
    },
  );

  test(
    'a staged file can be deleted, after a confirmation',
    routes('/upload'),
    async ({ page }) => {
      const name = `scratch-${Date.now().toString(36)}.txt`;
      await page.goto('/upload');
      await page.locator('input[type="file"]').setInputFiles(textFile(name, 'throwaway'));
      await page.getByRole('button', { name: `Delete ${name}` }).click();
      await expect(page.getByText('This cannot be undone.')).toBeVisible();
      await page.getByRole('button', { name: 'Keep' }).click();
      await page.getByRole('button', { name: `Delete ${name}` }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('button', { name: `Rename ${name}` })).toBeHidden();
    },
  );

  test(
    'a folder upload goes live in Receive and downloads as a zip',
    routes('/downloads/folder/:folderId', '/downloads/folder/:folderId/:id/preview'),
    async ({ page, newDevice }) => {
      // On the shared worker server on purpose: a folder created after others
      // is the case the downloads watcher used to miss (fixed after PLAN-32a).
      const folder = `Holiday ${Date.now().toString(36)}`;
      const deviceB = await newDevice();
      await deviceB.goto('/downloads');
      await waitForLive(deviceB);

      await page.goto('/upload');
      await waitForLive(page);
      await page.getByLabel('Folder in Receive (optional)').fill(folder);
      await page
        .locator('input[type="file"]')
        .setInputFiles([
          textFile('day-one.txt', 'sun\n'),
          textFile('day-two.md', '# rain\n', 'text/markdown'),
        ]);

      // Straight into the folder: live for everyone, no Move step.
      await expect(deviceB.getByRole('status').filter({ hasText: `in ${folder}` })).toBeVisible();
      const folderLink = deviceB.getByRole('link', { name: new RegExp(folder) }).first();
      await expect(folderLink).toBeVisible();
      // This folder's own size label, derived from both file rows — not the
      // banner, whose "2 files are ready" arrives before the watcher lists them.
      const folderRow = deviceB.locator('.file-row').filter({ has: folderLink });
      await expect(folderRow).toContainText(/2 files · /);
      await press(deviceB, folderLink);

      await expect(deviceB).toHaveURL(/\/downloads\/folder\/[^/]+$/);
      await expect(deviceB.getByRole('heading', { name: folder })).toBeVisible();
      await expect(deviceB.getByRole('link', { name: 'Download day-one.txt' })).toBeVisible();
      await expect(deviceB.getByRole('link', { name: 'Download day-two.md' })).toBeVisible();

      await deviceB.getByRole('link', { name: 'Preview day-one.txt' }).click();
      await expect(deviceB).toHaveURL(/\/downloads\/folder\/[^/]+\/[^/]+\/preview$/);
      await expect(deviceB.getByRole('dialog')).toContainText('sun');
      await deviceB.goBack();

      const [zip] = await Promise.all([
        deviceB.waitForEvent('download'),
        deviceB.getByRole('link', { name: /Download folder as \.zip/ }).click(),
      ]);
      expect(zip.suggestedFilename()).toBe(`${folder}.zip`);
      expect(zipEntryNames(await downloadBytes(zip)).sort()).toEqual(['day-one.txt', 'day-two.md']);

      await deviceB.getByRole('link', { name: /Back to Receive/ }).click();
      await expect(deviceB).toHaveURL(/\/downloads$/);
    },
  );
});
