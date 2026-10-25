import { test, expect } from '../support/fixtures.js';
import { Api, saveDocument } from '../support/api.js';
import { routes } from '../support/journey.js';
import { makePdf } from '../support/pdf.js';
import { press } from '../support/ui.js';

/** Journey 14 — Saga: present a saved Edda (navigation, notes, shortcuts), and drop a PDF. */

const DECK = [
  '# Bifröst',
  '<!-- notes: welcome the room -->',
  '',
  '---',
  '',
  '# Asgard',
  '',
  '---',
  '',
  '# Midgard',
  '',
].join('\n');

test(
  'a saved edda is presented from the Pensieve: navigation, notes, shortcuts',
  routes('/saga/:slug'),
  async ({ page, server }) => {
    const name = `E2E deck ${Date.now().toString(36)}`;
    await saveDocument(new Api(server.baseUrl), 'edda', DECK, name);
    await page.goto('/pensieve?type=edda');
    await page.getByRole('link', { name: `Present ${name}` }).click();
    await expect(page).toHaveURL(/\/saga\/[a-z0-9-]+$/);

    const position = page.locator('.saga-footer__position');
    await expect(position).toHaveText('1 / 3');
    await expect(page.getByRole('heading', { name: 'Bifröst' })).toBeVisible();

    await press(page, page.getByRole('button', { name: 'Next slide' }));
    await expect(position).toHaveText('2 / 3');
    await expect(page.getByRole('heading', { name: 'Asgard' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(position).toHaveText('3 / 3');
    await expect(page.getByRole('button', { name: 'Next slide' })).toBeDisabled();
    await page.keyboard.press('Home');
    await expect(position).toHaveText('1 / 3');

    await press(page, page.getByRole('button', { name: 'Show presenter notes' }));
    await expect(page.getByRole('complementary', { name: 'Presenter notes' })).toContainText(
      'welcome the room',
    );
    await press(page, page.getByRole('button', { name: 'Hide presenter notes' }));

    await press(page, page.getByRole('button', { name: 'Keyboard shortcuts' }));
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(shortcuts.getByRole('heading', { name: 'Shortcuts' })).toBeVisible();
    await press(page, shortcuts.getByRole('button', { name: 'Close shortcuts' }));
    await expect(shortcuts).toBeHidden();
  },
);

test('a dropped PDF presents page by page', routes('/saga'), async ({ page }) => {
  await page.goto('/saga');
  await expect(page.getByRole('heading', { name: 'Present a deck' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'realms.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(['Realm one', 'Realm two']),
  });
  const position = page.locator('.saga-footer__position');
  await expect(position).toHaveText('1 / 2');
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  // A PDF page can carry no note, so the notes control is withheld entirely.
  await expect(page.getByRole('button', { name: 'Show presenter notes' })).toHaveCount(0);
  await press(page, page.getByRole('button', { name: 'Next slide' }));
  await expect(position).toHaveText('2 / 2');
  await expect(page.getByRole('img', { name: 'Page 2' })).toBeVisible();
});
