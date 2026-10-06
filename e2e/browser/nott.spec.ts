import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import { isMobile, waitForLive } from '../support/ui.js';

/**
 * Journey 16 — Nótt: the idle overlay appears after the configured idle time
 * and a click or a keystroke dismisses it; on a phone it never appears at all.
 * The idle timer is the page's own, so `page.clock` drives it.
 */
test(
  'the idle overlay comes on desktops only, and a click or key sends it away',
  routes('/'),
  async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await waitForLive(page);
    const overlay = page.locator('.nott');

    // The default idle time is 60 seconds.
    await page.clock.runFor(61_000);
    if (isMobile(page)) {
      await expect(overlay).toHaveCount(0);
      return;
    }
    await expect(overlay).toBeVisible();
    await expect(overlay.getByText('Nótt')).toBeVisible();
    await page.mouse.click(400, 400);
    await expect(overlay).toHaveCount(0);

    await page.clock.runFor(61_000);
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Space');
    await expect(overlay).toHaveCount(0);
  },
);
