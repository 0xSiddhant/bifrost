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
 * viewport, a mouse click on a desktop. Not cosmetic — the guide sheet's drag
 * header takes pointer capture, which retargets a *mouse* click below 640px
 * while a real tap still lands (found by this suite, reported in PLAN-32a).
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
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
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

/**
 * Open a page that shows a live list and wait until it is live AND no fetch
 * of that list is still in flight.
 *
 * KNOWN BUG (found by this suite, reported in PLAN-32a): `useDownloads` and
 * `useClipboard` each fetch their whole list on mount (Receive also on every
 * SSE `open`) and *replace* their state with the answer — so a fetch computed
 * before a live event but delivered after it silently drops that row until a
 * reload. A journey that triggers a live event while that fetch is in flight
 * would be testing the race, not the live update, so it settles first.
 */
export async function openSettled(page: Page, url: string, listPath: string): Promise<void> {
  let inflight = 0;
  let finished = 0;
  const isList = (requestUrl: string) => new URL(requestUrl).pathname === listPath;
  const started = (request: { url(): string }) => {
    if (isList(request.url())) inflight += 1;
  };
  const ended = (request: { url(): string }) => {
    if (!isList(request.url())) return;
    inflight -= 1;
    finished += 1;
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  try {
    await page.goto(url);
    await waitForLive(page);
    for (let settled = 0; settled < 2; settled += 1) {
      await expect.poll(() => inflight === 0 && finished > 0).toBe(true);
      await page.waitForTimeout(250);
    }
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
  }
}

/** The Receive listing, settled (see `openSettled`). */
export function openReceive(page: Page, url: string): Promise<void> {
  return openSettled(page, url, '/api/downloads');
}

/** The Hermes board, settled (see `openSettled`). */
export function openHermes(page: Page, url = '/hermes'): Promise<void> {
  return openSettled(page, url, '/api/clipboard');
}
