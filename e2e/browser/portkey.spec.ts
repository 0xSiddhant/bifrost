import { test, expect } from '../support/fixtures.js';
import { routes } from '../support/journey.js';
import { waitForLive } from '../support/ui.js';

/**
 * Journey 10 — Portkey: create; a taken slug offers a free variant; `/go/:slug`
 * redirects and the hit count rises live; QR, edit, delete; an unknown slug
 * bounces to the page with the form pre-filled.
 */
test(
  'a go-link is enchanted, followed, counted live, edited and removed',
  routes('/portkey'),
  async ({ page, server, newDevice }) => {
    const slug = `hall-${Date.now().toString(36)}`;
    const target = `${server.baseUrl}/hermes`;

    await page.goto('/portkey');
    await waitForLive(page);
    await page.getByPlaceholder('router').fill(slug);
    await page.getByPlaceholder(/192\.168\.1\.1/).fill(target);
    await page.getByPlaceholder('what it points at').fill('the shared board');
    await page.getByRole('button', { name: 'Enchant' }).click();
    // By the slug link's exact name: a free variant like `<slug>-2` contains it.
    const cardFor = (name: string) =>
      page
        .locator('article.pk-card')
        .filter({ has: page.getByRole('link', { name: `/go/${name}`, exact: true }) });
    const card = cardFor(slug);
    await expect(card).toBeVisible();
    await expect(card.locator('.pk-card__hits')).toHaveText('0 hits');

    // The same slug again: refused, with a free variant offered.
    await page.getByPlaceholder('router').fill(slug);
    await page.getByPlaceholder(/192\.168\.1\.1/).fill(target);
    await page.getByRole('button', { name: 'Enchant' }).click();
    const variant = page.getByRole('alert').getByRole('button', { name: /^Use \/go\// });
    await expect(variant).toBeVisible();
    const freeSlug = ((await variant.textContent()) ?? '').replace('Use /go/', '');
    expect(freeSlug).not.toBe(slug);
    await variant.click();
    await expect(cardFor(freeSlug)).toBeVisible();

    // Follow it from another device: a 302, and this page's count rises live.
    const deviceB = await newDevice();
    await deviceB.goto(`/go/${slug}`);
    await expect(deviceB).toHaveURL(/\/hermes$/);
    await expect(card.locator('.pk-card__hits')).toHaveText('1 hit');
    const hop = await page.request.get(`${server.baseUrl}/go/${slug}`, { maxRedirects: 0 });
    expect(hop.status()).toBe(302);
    expect(hop.headers()['location']).toBe(target);
    expect(hop.headers()['cache-control']).toBe('no-store');
    await expect(card.locator('.pk-card__hits')).toHaveText('2 hits');

    await card.getByRole('button', { name: `Show QR for /go/${slug}` }).click();
    await expect(card.getByRole('img', { name: `QR to /go/${slug}` })).toBeVisible();
    await card.getByRole('button', { name: 'Hide QR' }).click();

    await card.getByRole('button', { name: `Edit /go/${slug}` }).click();
    await card.getByLabel('Note').fill('moved to the hall');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.locator('.pk-card__note')).toHaveText('moved to the hall');

    await card.getByRole('button', { name: `Delete /go/${slug}` }).click();
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card).toBeHidden();

    // Now unknown: the hop bounces to the page, form pre-filled.
    await deviceB.goto(`/go/${slug}`);
    await expect(deviceB).toHaveURL(/\/portkey/);
    await expect(deviceB.getByPlaceholder('router')).toHaveValue(slug);
  },
);
