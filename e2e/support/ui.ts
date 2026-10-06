import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Small, shared page vocabulary. Locators are by role and accessible name —
 * what a user (and a screen reader) sees — never by CSS class, so a restyle
 * cannot break a journey that still works for a person.
 */

/** The main nav that is visible at this viewport (top on desktop, bottom on phones). */
export function mainNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
}

export async function navigate(
  page: Page,
  label: 'Midgard' | 'Ollivanders' | 'Diagon Alley',
): Promise<void> {
  await mainNav(page).getByRole('link', { name: label }).click();
}

/** The SSE status in the footer reads `open` once the event stream is connected. */
export async function waitForLive(page: Page): Promise<void> {
  await expect(page.locator('.shell-footer')).toContainText(/\bopen\b/, { timeout: 15_000 });
}

export function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/**
 * Activate a control the way this device would: a touch tap on a phone-sized
 * viewport, a mouse click on a desktop.
 */
export async function press(page: Page, target: Locator): Promise<void> {
  if (isMobile(page)) await target.tap();
  else await target.click();
}

/**
 * Replace everything in the page's `index`-th visible CodeMirror editor
 * (default the first) with `text`, as one paste-like insert — some editors
 * open on a starter document.
 */
export async function typeIntoEditor(page: Page, text: string, index = 0): Promise<void> {
  const editor = page.locator('.cm-content').filter({ visible: true }).nth(index);
  // fill() selects the editor's whole content itself and inserts the text, as
  // a paste would. A select-all shortcut depends on the engine and the
  // emulated platform: on CI's WebKit with an iPhone profile, Ctrl+A selected
  // nothing, so the text was appended to Atlas's starting skeleton.
  await editor.fill(text);
  const firstLine = text.split('\n').find((line) => line.trim() !== '');
  if (firstLine) await expect(editor).toContainText(firstLine.trim());
}

/** The text of the page's (first visible) CodeMirror editor. */
export function editorText(page: Page): Locator {
  return page.locator('.cm-content').filter({ visible: true }).first();
}

/** Accept the next `window.confirm` the page raises. */
export function acceptNextDialog(page: Page): void {
  page.once('dialog', (dialog) => void dialog.accept());
}

/**
 * Bring a JSON/YAML/XML page's code editor on screen. On a phone those pages
 * can open in Tree (or Table) view, with Code a tap away as it is for a person;
 * Atlas offers the toggle only for a property list, so this waits for
 * whichever of editor or toggle shows up rather than for the toggle itself.
 */
export async function showCode(page: Page): Promise<void> {
  const code = page.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Code' });
  await expect(editorText(page).or(code).first()).toBeVisible();
  if (await editorText(page).isVisible()) return;
  await press(page, code);
  await expect(editorText(page)).toBeVisible();
}
