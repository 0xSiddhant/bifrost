import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { RunningApp } from '../../app.js';
import { createTestApp } from '../../testing/app.js';

/**
 * `GET /api/qr/server-url` (PLAN-32c): every way onto the server, LAN IPs
 * first. The mDNS name comes last and only in the local profile — a cloud
 * deployment has no `.local` name to offer.
 */

describe('qr-tool', () => {
  let app: RunningApp | undefined;

  afterEach(async () => {
    if (!app) return;
    await app.shutdown();
    fs.rmSync(app.config.storage.root, { recursive: true, force: true });
    app = undefined;
  });

  const urls = async (): Promise<string[]> => {
    const response = await app?.fastify.inject('/api/qr/server-url');
    expect(response?.statusCode).toBe(200);
    return response?.json<{ urls: string[] }>().urls ?? [];
  };

  it('ends with the mDNS name in the local profile, every URL on the configured port', async () => {
    app = await createTestApp({ PORT: '4747', MDNS_NAME: 'bifrost-qr-test' });
    const list = await urls();
    expect(list.at(-1)).toBe('http://bifrost-qr-test.local:4747');
    for (const url of list) expect(url).toMatch(/^http:\/\/[^/]+:4747$/);
    expect(list.slice(0, -1).every((url) => !url.includes('.local'))).toBe(true);
  });

  it('offers no .local name in the cloud profile', async () => {
    app = await createTestApp({ DEPLOY_PROFILE: 'cloud', PORT: '4747' });
    expect((await urls()).some((url) => url.includes('.local'))).toBe(false);
  });
});
