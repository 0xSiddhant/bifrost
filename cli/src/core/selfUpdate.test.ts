import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from './config.js';
import {
  checkLatest,
  cliVersion,
  compareVersions,
  findCliAsset,
  LATEST_RELEASE_URL,
  THROTTLE_MS,
} from './selfUpdate.js';
import { failure } from '../test/failure.js';

let home: string;

function release(tag: string, assetNames: string[] = [`bifrost-cli-${tag.slice(1)}.tgz`]): Response {
  return new Response(
    JSON.stringify({
      tag_name: tag,
      assets: assetNames.map((name) => ({
        name,
        browser_download_url: `https://github.com/0xSiddhant/bifrost/releases/download/${tag}/${name}`,
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-cli-update-'));
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('cliVersion', () => {
  it('reads the version out of the package.json that ships beside dist/', () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('checkLatest', () => {
  it('strips the leading v and finds the CLI tarball among the assets', async () => {
    const call = vi.fn(() => Promise.resolve(release('v1.4.0')));

    const latest = await checkLatest({ now: 1_000, fetchImpl: call as unknown as typeof fetch });

    expect(call).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.anything());
    expect(latest).toMatchObject({
      version: '1.4.0',
      cached: false,
      assetUrl: expect.stringContaining('bifrost-cli-1.4.0.tgz') as unknown as string,
    });
  });

  it('answers from the cache inside the six-hour window, with no request at all', async () => {
    const call = vi.fn(() => Promise.resolve(release('v1.4.0')));
    await checkLatest({ now: 1_000, fetchImpl: call as unknown as typeof fetch });

    const second = await checkLatest({
      now: 1_000 + THROTTLE_MS - 1,
      fetchImpl: call as unknown as typeof fetch,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ version: '1.4.0', cached: true, checkedAt: 1_000 });
  });

  it('refreshes once the window has passed', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(release('v1.4.0'))
      .mockResolvedValueOnce(release('v1.5.0'));
    await checkLatest({ now: 1_000, fetchImpl: call as unknown as typeof fetch });

    const second = await checkLatest({
      now: 1_000 + THROTTLE_MS,
      fetchImpl: call as unknown as typeof fetch,
    });

    expect(call).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ version: '1.5.0', cached: false });
    expect(readConfig().update).toMatchObject({ latestVersion: '1.5.0' });
  });

  it('treats a release with no CLI tarball as a release without one, not a crash', async () => {
    const call = vi.fn(() => Promise.resolve(release('v1.4.0', ['bifrost-v1.4.0.tar.gz'])));

    const latest = await checkLatest({ now: 1_000, fetchImpl: call as unknown as typeof fetch });

    expect(latest.assetUrl).toBeNull();
  });

  it('reports an unreachable GitHub as a sentence', async () => {
    const call = vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com')));

    const error = await failure(
      checkLatest({ now: 1_000, fetchImpl: call as unknown as typeof fetch }),
    );

    expect(error.message).toContain("couldn't reach GitHub");
    expect(error.message).toContain('ENOTFOUND');
  });

  it('reports a rate-limited or errored GitHub by status', async () => {
    const call = vi.fn(() => Promise.resolve(new Response('{}', { status: 403 })));

    await expect(
      checkLatest({ now: 1_000, fetchImpl: call as unknown as typeof fetch }),
    ).rejects.toThrow('HTTP 403');
  });
});

describe('findCliAsset', () => {
  it('picks only a bifrost-cli tarball, and tolerates junk in the array', () => {
    expect(findCliAsset('not an array')).toBeNull();
    expect(findCliAsset([null, 42, { name: 'notes.txt', browser_download_url: 'x' }])).toBeNull();
    expect(
      findCliAsset([{ name: 'bifrost-cli-2.0.0.tgz', browser_download_url: 'https://x/y.tgz' }]),
    ).toBe('https://x/y.tgz');
  });
});

describe('compareVersions', () => {
  it('is plain inequality, so a locally-ahead dev install reads as a mismatch too', () => {
    expect(compareVersions('1.3.0', '1.3.0').mismatch).toBe(false);
    expect(compareVersions('1.3.0', '1.4.0').mismatch).toBe(true);
    // The dev-machine case: cli-sync installs from develop, so the local build
    // can be ahead of the last published tag. Still "these differ", never
    // "update available", which would be telling the owner to downgrade.
    expect(compareVersions('1.5.0', '1.4.0').mismatch).toBe(true);
  });
});
