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
/** Editor text compared loosely: CodeMirror renders a blank line as an extra newline. */
const normalised = (text: string): string => text.replace(/\n+/g, '\n').replace(/\s+$/, '');

export async function typeIntoEditor(page: Page, text: string, index = 0): Promise<void> {
  const editor = page.locator('.cm-content').filter({ visible: true }).nth(index);
  // Each engine gets the input method proven on it in CI:
  // - WebKit (the iPhone profile): `fill()`, which selects the editor's
  //   content itself. Ctrl+A selected nothing there, and ⌘A then typing left
  //   the editor empty.
  // - Chromium: select-all with the keyboard, then typing. `fill()` under
  //   Chromium's Android emulation sometimes appended instead of replacing
  //   (1 run in 6), and the page saved the mangled result.
  // Either way the editor must hold exactly the text, now and a moment later,
  // or the step is retried — an input slip fails here, not three steps on.
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  for (let attempt = 1; ; attempt += 1) {
    if (webkit) {
      await editor.fill(text);
    } else {
      await editor.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(text);
    }
    try {
      await expect
        .poll(async () => normalised(await editor.innerText()), { timeout: 2_000 })
        .toBe(normalised(text));
      await page.waitForTimeout(250);
      expect(normalised(await editor.innerText())).toBe(normalised(text));
      return;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
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
