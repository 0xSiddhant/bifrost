import { test, expect } from '../support/fixtures.js';
import { Api, saveDocument } from '../support/api.js';
import { routes } from '../support/journey.js';
import { waitForSkyAndSlots } from '../support/animations.js';
import { editorText, isMobile, press, showCode, typeIntoEditor } from '../support/ui.js';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * PLAN-43 — per-tab editor drafts, with two (or more) tabs of one browser:
 * pages of one context share `localStorage` and each has its own
 * `sessionStorage`, as tabs do.
 *
 * A closed tab's draft is offered only after a 10 s grace (a reload must not
 * look like a close), so the offer journeys wait for it; pruning after 10
 * minutes is left to the unit tests.
 */

const RECORDS = 'bifrost.drafts.v1.r.';
const OFFER_TIMEOUT = 25_000;

type Editor = 'runestone' | 'edda' | 'groot' | 'atlas';

/** This tab's draft text for an editor's scratch workspace, as stored. */
async function ownScratch(page: Page, feature: string): Promise<string | null> {
  return page.evaluate(
    ([prefix, editor]) => {
      const tab = sessionStorage.getItem('bifrost.tab.id');
      const raw = tab ? localStorage.getItem(`${prefix}${editor}.${tab}.scratch`) : null;
      return raw === null ? null : (JSON.parse(raw) as { payload: { text: string } }).payload.text;
    },
    [RECORDS, feature] as const,
  );
}

async function recordKeys(page: Page, feature: string): Promise<string[]> {
  return page.evaluate(
    (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).sort(),
    `${RECORDS}${feature}.`,
  );
}

async function tabId(page: Page): Promise<string | null> {
  return page.evaluate(() => sessionStorage.getItem('bifrost.tab.id'));
}

/** Open an editor in a new tab of the same browser, with its code editor showing. */
async function openTab(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await bringEditor(page);
  return page;
}

/**
 * Bring a tab's code editor on screen, switching to the tab first as a person
 * would: WebKit gives a tab that is not in front no animation frames, and
 * Playwright waits for frames before it taps (a `window.open` copy's Code
 * toggle never became "stable" on webkit-mobile).
 */
async function bringEditor(page: Page): Promise<void> {
  await page.bringToFront();
  if (page.url().includes('/edda') || page.url().includes('/variant')) {
    await expect(editorText(page)).toBeVisible();
    return;
  }
  await showCode(page);
}

/** Type, then wait for the 500 ms mirror to have stored it. */
async function typeAndKeep(page: Page, feature: string, text: string): Promise<void> {
  await page.bringToFront();
  await typeIntoEditor(page, text);
  await expect.poll(() => ownScratch(page, feature)).toBe(text);
}

/**
 * Close a tab as a person does, where unload handlers run and the tab records
 * leaving. A browser's own close fires `pagehide` (the PLAN-43 spike saw it in
 * Chromium, with or without `runBeforeUnload`), but Playwright's WebKit never
 * completes a `runBeforeUnload` close and may skip the handlers on a plain
 * one. So the page is sent the `pagehide` a close sends, checked to have
 * recorded leaving, then closed.
 */
async function closeTab(page: Page): Promise<void> {
  const left = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const tab = sessionStorage.getItem('bifrost.tab.id');
    return tab !== null && localStorage.getItem(`bifrost.drafts.v1.left.${tab}`) !== null;
  });
  expect(left, 'the closing tab recorded leaving').toBe(true);
  await page.close();
}

/**
 * `page.clock` is the context's: every tab's time jumps together. A jump over
 * a chunk still loading fires its 8 s timeout at once, so the sky's idle-time
 * chunks have to have arrived first (as in nott.spec.ts).
 */
async function settledForClock(page: Page): Promise<void> {
  await waitForSkyAndSlots(page);
}

/**
 * Jump the clock by `minutes`. A minute of idleness brings Nótt, the
 * screensaver, whose chunk loads only then (desktops; phones never show it):
 * jump just past that minute, let its overlay arrive, then jump the rest, or
 * the long jump fires the chunk's 8 s timeout while it is still in flight.
 */
async function jumpMinutes(page: Page, minutes: number): Promise<void> {
  await page.clock.fastForward('01:05');
  if (!isMobile(page)) await expect(page.locator('.nott')).toBeVisible();
  await page.clock.fastForward((minutes * 60 - 65) * 1000);
}

const restoreBanner = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Restore draft from another tab?' });

const CONTENT: Record<Editor, [string, string]> = {
  runestone: ['{"tab":"one"}', '{"tab":"two"}'],
  edda: ['# Tab one', '# Tab two'],
  groot: ['tab: one', 'tab: two'],
  atlas: [
    '<?xml version="1.0" encoding="UTF-8"?>\n<tab>one</tab>',
    '<?xml version="1.0" encoding="UTF-8"?>\n<tab>two</tab>',
  ],
};

const EDITOR_ROUTES: Record<Editor, { tag: string[] }> = {
  runestone: routes('/runestone'),
  edda: routes('/edda'),
  groot: routes('/groot'),
  atlas: routes('/atlas'),
};

for (const editor of Object.keys(CONTENT) as Editor[]) {
  test(
    `${editor}: two tabs keep separate drafts, and a reload brings back only its own`,
    EDITOR_ROUTES[editor],
    async ({ page, context }) => {
      const [first, second] = CONTENT[editor];
      await page.goto(`/${editor}`);
      await bringEditor(page);
      const other = await openTab(context, `/${editor}`);
      await typeAndKeep(page, editor, first);
      await typeAndKeep(other, editor, second);
      expect(await recordKeys(page, editor)).toHaveLength(2);
      const id = await tabId(page);

      await page.reload();
      await bringEditor(page);
      await expect(editorText(page)).toContainText(first.split('\n').pop() ?? first);
      // A reload is the same tab: it keeps its id, and so its draft's key.
      expect(await tabId(page)).toBe(id);
      // Its own draft simply comes back: nothing is offered.
      await expect(page.getByText('Restore draft')).toHaveCount(0);
      await expect.poll(() => ownScratch(page, editor)).toBe(first);
      expect(await ownScratch(other, editor)).toBe(second);
      await expect(editorText(other)).toContainText(second.split('\n').pop() ?? second);
    },
  );
}

test(
  'runestone: a closed tab’s draft is offered once, to one tab, and dismissing keeps it',
  routes('/runestone'),
  async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.goto('/runestone');
    await bringEditor(page);
    await typeAndKeep(page, 'runestone', '{"left":"behind"}');
    const peer = await openTab(context, '/runestone');
    await typeAndKeep(peer, 'runestone', '{"peer":"stays"}');
    await closeTab(page);

    // A blank new tab is offered it once the closed tab cannot be a reload.
    const first = await openTab(context, '/runestone');
    await expect(restoreBanner(first)).toBeVisible({ timeout: OFFER_TIMEOUT });
    await press(first, restoreBanner(first).getByRole('button', { name: 'Dismiss' }));
    await expect(restoreBanner(first)).toHaveCount(0);

    // Dismissed, not discarded: two more blank tabs are both offered it, and
    // only one of them can take it.
    const second = await openTab(context, '/runestone');
    const third = await openTab(context, '/runestone');
    await expect(restoreBanner(second)).toBeVisible({ timeout: OFFER_TIMEOUT });
    await expect(restoreBanner(third)).toBeVisible({ timeout: OFFER_TIMEOUT });
    await Promise.all([
      restoreBanner(second).getByRole('button', { name: 'Restore' }).click(),
      restoreBanner(third).getByRole('button', { name: 'Restore' }).click(),
    ]);
    const outcomes = await Promise.all(
      [second, third].map(async (tab) => {
        await expect(restoreBanner(tab)).toHaveCount(0);
        return ownScratch(tab, 'runestone');
      }),
    );
    expect(outcomes.filter((text) => text === '{"left":"behind"}')).toHaveLength(1);
    const loser = outcomes[0] === null ? second : third;
    await expect(loser.getByText('That draft is no longer available')).toBeVisible();

    // The peer that stayed open was never touched.
    expect(await ownScratch(peer, 'runestone')).toBe('{"peer":"stays"}');
    // Taken once: a fresh tab is offered nothing.
    const fourth = await openTab(context, '/runestone');
    await fourth.waitForTimeout(1_500);
    await expect(restoreBanner(fourth)).toHaveCount(0);
  },
);

/** Open a Runestone tab, type a draft, and return it with its record key. */
async function draftTab(context: BrowserContext, text: string): Promise<{ tab: Page; key: string }> {
  const tab = await openTab(context, '/runestone');
  await typeAndKeep(tab, 'runestone', text);
  const id = await tabId(tab);
  return { tab, key: `${RECORDS}runestone.${id}.scratch` };
}

const stillStored = (page: Page, keys: string[]) =>
  page.evaluate((list) => list.filter((key) => localStorage.getItem(key) !== null), keys);

test(
  'runestone: closing all but one tab prunes the closed tabs’ drafts once the open one has its own',
  routes('/runestone'),
  async ({ page, context }) => {
    // The open tab's clock jumps the 10-minute prune grace.
    await page.clock.install();
    await page.goto('/runestone');
    await bringEditor(page);
    await typeAndKeep(page, 'runestone', '{"survivor":true}');
    const a = await draftTab(context, '{"closed":"a"}');
    const b = await draftTab(context, '{"closed":"b"}');
    await closeTab(a.tab);
    await closeTab(b.tab);
    await settledForClock(page);
    await jumpMinutes(page, 9);
    await page.waitForTimeout(500);
    // Not yet: a closed tab's draft is kept for ten minutes.
    expect(await stillStored(page, [a.key, b.key])).toEqual([a.key, b.key]);
    await page.clock.fastForward('02:00');
    await expect.poll(() => stillStored(page, [a.key, b.key]), { timeout: 10_000 }).toEqual([]);
    expect(await ownScratch(page, 'runestone')).toBe('{"survivor":true}');
  },
);

test(
  'runestone: two tabs closing at once leave the newest draft, never none',
  routes('/runestone'),
  async ({ page, context }) => {
    await page.clock.install();
    await page.goto('/runestone');
    await bringEditor(page);
    const a = await draftTab(context, '{"closed":"a"}');
    const b = await draftTab(context, '{"closed":"b"}');
    await Promise.all([closeTab(a.tab), closeTab(b.tab)]);
    await settledForClock(page);
    // This tab has no draft of its own: one closed draft stays, to be offered.
    await jumpMinutes(page, 11);
    await expect.poll(() => stillStored(page, [a.key, b.key]), { timeout: 10_000 }).toHaveLength(1);
    await page.clock.fastForward('30:00');
    await page.waitForTimeout(500);
    expect(await stillStored(page, [a.key, b.key])).toHaveLength(1);
    await page.reload();
    await expect(restoreBanner(page)).toBeVisible({ timeout: OFFER_TIMEOUT });
  },
);

test(
  'runestone: a duplicated tab gets an id of its own and none of its original’s draft',
  routes('/runestone'),
  async ({ page, context }) => {
    await page.goto('/runestone');
    await bringEditor(page);
    await typeAndKeep(page, 'runestone', '{"original":true}');
    // window.open copies the opener's sessionStorage, as "Duplicate tab" does.
    const [copy] = await Promise.all([
      context.waitForEvent('page'),
      page.evaluate(() => {
        window.open('/runestone', '_blank');
      }),
    ]);
    await copy.waitForLoadState();
    await bringEditor(copy);
    await expect.poll(() => tabId(copy)).not.toBe(null);
    expect(await tabId(copy)).not.toBe(await tabId(page));
    await expect(editorText(copy)).not.toContainText('original');
    await typeAndKeep(copy, 'runestone', '{"copy":true}');
    expect(await ownScratch(page, 'runestone')).toBe('{"original":true}');
  },
);

test(
  'runestone: the draft saved before this update is offered until taken, then once only',
  routes('/runestone'),
  async ({ page, context }) => {
    await page.goto('/runestone');
    await page.evaluate(() =>
      localStorage.setItem(
        'bifrost.runestone.draft',
        JSON.stringify({ title: 'Before the update', text: '{"legacy":1}', savedAt: 1 }),
      ),
    );
    await page.reload();
    const legacy = page.getByRole('status').filter({ hasText: 'Restore draft saved before this update?' });
    await expect(legacy).toBeVisible();
    await press(page, legacy.getByRole('button', { name: 'Dismiss' }));
    await expect(legacy).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('bifrost.runestone.draft'))).not.toBeNull();

    await page.reload();
    await press(page, legacy.getByRole('button', { name: 'Restore' }));
    await bringEditor(page);
    await expect(editorText(page)).toContainText('legacy');
    await expect(page.getByLabel('Document title')).toHaveValue('Before the update');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bifrost.runestone.draft'))).toBeNull();

    const other = await openTab(context, '/runestone');
    await other.waitForTimeout(1_500);
    await expect(other.getByText('Restore draft saved before this update?')).toHaveCount(0);
  },
);

test(
  'runestone: a saved document’s unsaved edits come back after a reload, and a server change asks first',
  routes('/runestone/:slug'),
  async ({ page, server }) => {
    const api = new Api(server.baseUrl);
    const doc = await saveDocument(api, 'runestone', '{"server":1}', 'Kept on the server');
    await page.goto(`/runestone/${doc.slug}`);
    await bringEditor(page);
    await typeIntoEditor(page, '{"local":1}');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.waitForTimeout(800);

    await page.reload();
    await bringEditor(page);
    await expect(editorText(page)).toContainText('local');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    // Never saved on its own.
    const raw = await page.request.get(`${server.baseUrl}/runestone/api/v1/${doc.slug}`);
    expect(await raw.text()).toBe('{"server":1}');

    // Another device saves meanwhile: the reload asks which copy to keep.
    await api.put(`/api/v1/runestone/${doc.id}`, { content: '{"elsewhere":2}' });
    await page.reload();
    const conflict = page.getByRole('status').filter({ hasText: 'changed on the server' });
    await expect(conflict).toBeVisible();
    await bringEditor(page);
    await expect(editorText(page)).toContainText('local');
    await press(page, conflict.getByRole('button', { name: 'Use server version' }));
    await expect(editorText(page)).toContainText('elsewhere');
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  },
);

test(
  'variant: both workspaces come back after a reload, without the compare results',
  routes('/variant'),
  async ({ page }) => {
    await page.goto('/variant');
    await typeIntoEditor(page, '{"side":"left"}', 0);
    await typeIntoEditor(page, '{"side":"right"}', 1);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    const mode = page.getByRole('group', { name: 'Compare mode' });
    await press(page, mode.getByRole('button', { name: 'Text' }));
    await typeIntoEditor(page, 'alpha', 0);
    await typeIntoEditor(page, 'beta', 1);
    await page.waitForTimeout(800);

    await page.reload();
    await expect(page.locator('.cm-content').filter({ visible: true }).nth(0)).toContainText('alpha');
    await expect(page.locator('.cm-content').filter({ visible: true }).nth(1)).toContainText('beta');
    await press(page, mode.getByRole('button', { name: 'JSON' }));
    await expect(page.locator('.cm-content').filter({ visible: true }).nth(0)).toContainText('left');
    await expect(page.locator('.cm-content').filter({ visible: true }).nth(1)).toContainText('right');
    if (!isMobile(page)) {
      // The compare markers are gone until Compare is pressed again.
      await expect(page.locator('.cm-diff-changed, .variant-hl')).toHaveCount(0);
    }
  },
);

test(
  'indexeddb read/write transactions exclude each other across tabs (the drafts lock)',
  routes('/runestone'),
  async ({ page, context }) => {
    // The guarantee the drafts' coordination rests on, checked in this engine.
    const tabs = [page, ...(await Promise.all([1, 2, 3].map(() => context.newPage())))];
    await Promise.all(tabs.map((tab) => tab.goto('/runestone')));
    const counts = await Promise.all(
      tabs.map((tab) =>
        tab.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('e2e-lock-check', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('s');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          for (let i = 0; i < 40; i += 1) {
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction('s', 'readwrite');
              const store = tx.objectStore('s');
              const read = store.get('n');
              read.onsuccess = () => store.put(((read.result as number | undefined) ?? 0) + 1, 'n');
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
          }
          db.close();
          return true;
        }),
      ),
    );
    expect(counts).toEqual([true, true, true, true]);
    const total = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const request = indexedDB.open('e2e-lock-check', 1);
          request.onsuccess = () => {
            const read = request.result.transaction('s').objectStore('s').get('n');
            read.onsuccess = () => resolve(read.result as number);
          };
        }),
    );
    expect(total).toBe(160);
  },
);
