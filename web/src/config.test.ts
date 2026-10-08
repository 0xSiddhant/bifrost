import { describe, expect, it } from 'vitest';
import { isLoopbackHost, loadWebConfig } from './config.js';
import { clientFor, mdnsDecision } from './main.js';

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
    expect(mdnsDecision({ profile: 'local', host: '0.0.0.0' })).toEqual({ advertise: true });
    expect(mdnsDecision({ profile: 'local', host: '127.0.0.1' })).toMatchObject({
      advertise: false,
    });
    expect(mdnsDecision({ profile: 'cloud', host: '0.0.0.0' })).toMatchObject({ advertise: false });
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
