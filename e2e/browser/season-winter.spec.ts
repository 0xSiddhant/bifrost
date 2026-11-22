import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import {
  expectCompositorOnly,
  runningAnimations,
  waitForSkyAndSlots,
} from '../support/animations.js';

/**
 * The winter season (client/src/seasons/winter): Yule turns on its snowfall,
 * string lights and snowy footer, and another theme shows none of them.
 * Delete this journey with the season (client/src/seasons/README.md).
 */
test.describe('the winter season', () => {
  test(
    'Yule shows snow, lights and a snowy footer, all on the compositor',
    routes('/'),
    async ({ page }) => {
      await page.goto('/');
      await waitForSkyAndSlots(page);
      await expect(page.locator('[data-decor-slot="sky"] .snowflake').first()).toBeAttached();
      await expect(page.locator('[data-decor-slot="header"] .string-lights')).toBeAttached();
      await expect(page.locator('[data-decor-slot="footer"] .footer-scene')).toBeAttached();

      const names = new Set((await runningAnimations(page)).map((animation) => animation.name));
      const expected = ['snow-fall', 'snow-gust-far', 'snow-gust-near', 'lights-twinkle'];
      // Phones hide the footer, and with it the sleigh (≤640 px).
      if ((page.viewportSize()?.width ?? 0) > 640) expected.push('sleigh-ride', 'sleigh-bob');
      for (const name of expected) expect(names, name).toContain(name);
      expectCompositorOnly(await runningAnimations(page));
    },
  );

  test('another theme shows no winter decoration', routes('/'), async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('bifrost.theme', 'aurora'));
    await page.reload();
    await waitForSkyAndSlots(page);
    await expect(page.locator('[data-decor-slot][data-decor-state="empty"]')).toHaveCount(3);
    await expect(page.locator('.snowflake, .string-lights, .footer-scene')).toHaveCount(0);
  });
});
