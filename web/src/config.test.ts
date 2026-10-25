import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot, isLoopbackHost, LAUNCHER_KEYS, loadWebConfig } from './config.js';
import { decisionFor } from './advertiser.js';
import { advertiserDecision, clientFor, mdnsDecision } from './main.js';

/** The web host reads the shared .env with the server's names and defaults (PLAN-36). */
const ENV = { DEPLOY_PROFILE: 'local', PORT: '4646', STORAGE_ROOT: './storage' };

describe('loadWebConfig', () => {
  it('defaults to the full hub on every interface, forwarding to loopback PORT + 1', () => {
    const config = loadWebConfig(ENV);
    expect(config).toMatchObject({
      port: 4646,
      host: '0.0.0.0',
      api: { host: '127.0.0.1', port: 4647 },
      runMode: 'full',
      mdnsName: 'bifrost',
    });
  });

  it('reads explicit keys', () => {
    const config = loadWebConfig({
      ...ENV,
      API_PORT: '5000',
      WEB_HOST: '127.0.0.1',
      BIFROST_RUN: 'web',
    });
    expect(config).toMatchObject({ host: '127.0.0.1', api: { port: 5000 }, runMode: 'web' });
  });

  it('refuses the same rules the server refuses', () => {
    expect(() => loadWebConfig({ ...ENV, API_PORT: '4646' })).toThrow(
      /API_PORT: must differ from PORT/,
    );
    expect(() => loadWebConfig({ ...ENV, PORT: '65535' })).toThrow(/PORT \+ 1 is not a port/);
    expect(() => loadWebConfig({ ...ENV, BIFROST_RUN: 'both' })).toThrow(/BIFROST_RUN/);
    expect(() => loadWebConfig({ DEPLOY_PROFILE: 'local' })).toThrow(/PORT/);
  });
});

describe('mode decisions', () => {
  it('advertises bifrost.local only for the local profile on a reachable bind', () => {
    const web = { mdnsAdvertiser: 'web' } as const;
    expect(mdnsDecision({ ...web, profile: 'local', host: '0.0.0.0' })).toEqual({
      advertise: true,
    });
    expect(mdnsDecision({ ...web, profile: 'local', host: '127.0.0.1' })).toMatchObject({
      advertise: false,
    });
    expect(mdnsDecision({ ...web, profile: 'cloud', host: '0.0.0.0' })).toMatchObject({
      advertise: false,
    });
  });

  it('leaves the name to the native advertiser with MDNS_ADVERTISER=host, and to nobody with off (PLAN-39)', () => {
    for (const mdnsAdvertiser of ['host', 'off'] as const) {
      expect(
        mdnsDecision({ profile: 'local', host: '0.0.0.0', mdnsAdvertiser }),
        mdnsAdvertiser,
      ).toMatchObject({ advertise: false, reason: expect.stringContaining(mdnsAdvertiser) });
    }
    expect(advertiserDecision({ profile: 'local', mdnsAdvertiser: 'host' })).toEqual({
      advertise: true,
    });
    for (const mdnsAdvertiser of ['web', 'off'] as const) {
      expect(advertiserDecision({ profile: 'local', mdnsAdvertiser }).advertise).toBe(false);
    }
    expect(advertiserDecision({ profile: 'cloud', mdnsAdvertiser: 'host' }).advertise).toBe(false);
  });

  it('defaults MDNS_ADVERTISER to web, and refuses an unknown value', () => {
    expect(loadWebConfig({ DEPLOY_PROFILE: 'local', PORT: '4646' }).mdnsAdvertiser).toBe('web');
    expect(
      loadWebConfig({ DEPLOY_PROFILE: 'local', PORT: '4646', MDNS_ADVERTISER: 'host' })
        .mdnsAdvertiser,
    ).toBe('host');
    expect(() =>
      loadWebConfig({ DEPLOY_PROFILE: 'local', PORT: '4646', MDNS_ADVERTISER: 'both' }),
    ).toThrow(/MDNS_ADVERTISER/);
  });

  it('runs the dev advertiser unless the name is off, and bifrost-mdns only for host', () => {
    const config = (mdnsAdvertiser: string, host = '0.0.0.0') =>
      loadWebConfig({ ...ENV, MDNS_ADVERTISER: mdnsAdvertiser, WEB_HOST: host });
    expect(decisionFor('dev', config('web')).advertise).toBe(true);
    expect(decisionFor('dev', config('host')).advertise).toBe(true);
    expect(decisionFor('dev', config('off')).advertise).toBe(false);
    expect(decisionFor('dev', config('web', '127.0.0.1')).advertise).toBe(false);
    expect(decisionFor('host', config('host')).advertise).toBe(true);
    expect(decisionFor('host', config('web')).advertise).toBe(false);
  });

  it('serves the hub client in full mode and the standalone client in web mode', () => {
    expect(clientFor({ runMode: 'full' }).dir).toMatch(/client[\\/]dist$/);
    expect(clientFor({ runMode: 'web' }).dir).toMatch(/client[\\/]dist-standalone$/);
  });

  it('knows a loopback bind', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
  });
});

describe('launcher keys', () => {
  it('are the same keys the API server ignores in .env', () => {
    // Workspaces do not import each other, so the server's list is read as text.
    const server = fs.readFileSync(
      fromRepoRoot('server', 'src', 'core', 'config', 'dotenv.ts'),
      'utf8',
    );
    const list = /LAUNCHER_KEYS = \[([^\]]*)\]/.exec(server)?.[1] ?? '';
    expect([...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])).toEqual([...LAUNCHER_KEYS]);
  });
});
