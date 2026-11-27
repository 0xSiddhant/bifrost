import type { BrowserContext } from '@playwright/test';

/**
 * The installed season's decorations a device can switch off (Heimdall → Sky
 * Relics), by id: winter's snowfall today. Written out here because e2e never
 * imports product source; an id the installed season does not have is simply
 * ignored by the app, so a season's removal breaks nothing. A new season adds
 * its switchable ids (client/src/seasons/README.md).
 */
export const SWITCHABLE_DECORATIONS: readonly string[] = ['snowfall'];

/** Where a device stores the decorations it switched off (client/src/core/decor/prefs.ts). */
const DECOR_OFF_KEY = 'bifrost.decor.off';

/**
 * Makes every page of `context` a device that has switched the season's
 * switchable decorations off, unless the page has stored a choice of its own.
 *
 * The journeys run with the snow off because it is the one decoration that
 * moves dozens of layers for as long as a tab is open, and WebKit without a
 * GPU (CI's containers, until WebKit left CI on 2026-11-27) composites them in
 * software: with four workers it delivered animation frames slowly enough
 * that taps waiting for an element to hold still timed out (Runestone's and
 * Groot's Code toggle above all). Real iPhones and iPads composite on the GPU. A journey about the
 * season opts back in with `test.use({ seasonDecorations: true })`.
 */
export async function switchOffSeasonDecorations(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ key, ids }) => {
      try {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(ids));
      } catch {
        // No storage here (about:blank, or one that refuses): the page then
        // shows its decorations, as a real device's would.
      }
    },
    { key: DECOR_OFF_KEY, ids: [...SWITCHABLE_DECORATIONS] },
  );
}
