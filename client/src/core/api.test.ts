import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onBridgeClosed, type BridgeClosedRequest } from './bridge';
import { ApiError, HubUnreachableError, apiGet, apiSend, isHubClosed } from './api';

vi.mock('./deviceId', () => ({ getDeviceId: () => 'test-device' }));

const globals = globalThis as { __BIFROST_BUILD__?: string; __bifrostStubCalls?: string[] };

describe('core/api in the hub build', () => {
  const sheets: BridgeClosedRequest[] = [];
  let off: () => void;

  beforeEach(() => {
    sheets.length = 0;
    off = onBridgeClosed((request) => sheets.push(request));
  });

  afterEach(() => {
    off();
    vi.unstubAllGlobals();
  });

  it('turns a refused connection into HubUnreachableError and opens the sheet', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const error = await apiGet('/api/v1/clipboard').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HubUnreachableError);
    expect(isHubClosed(error)).toBe(true);
    expect(sheets).toEqual([{ reason: 'unreachable' }]);
  });

  it('treats a timeoutMs that ran out as unreachable', async () => {
    const timeout = new DOMException('signal timed out', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(timeout)));
    await expect(apiGet('/api/v1/offline-mode/config', { timeoutMs: 10 })).rejects.toBeInstanceOf(
      HubUnreachableError,
    );
  });

  it("leaves the caller's own abort alone: that is the page cancelling, not the hub", async () => {
    const abort = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abort)));
    await expect(apiGet('/api/v1/runestone', { signal: new AbortController().signal })).rejects.toBe(abort);
    expect(sheets).toEqual([]);
  });

  it('keeps an HTTP error an ApiError, because the server answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'NOPE', message: 'no' }), { status: 500 })),
    );
    const error = await apiSend('POST', '/api/v1/runestone', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(isHubClosed(error)).toBe(false);
    expect(sheets).toEqual([]);
  });

  it("treats the web host's HUB_UNAVAILABLE 502 as the bridge closed, on reads and writes", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'HUB_UNAVAILABLE', message: 'down' }), { status: 502 }),
      ),
    );
    const read = await apiGet('/api/v1/clipboard').catch((caught: unknown) => caught);
    const write = await apiSend('POST', '/api/v1/runestone', {}).catch((caught: unknown) => caught);
    for (const error of [read, write]) {
      expect(error).toBeInstanceOf(HubUnreachableError);
      expect(isHubClosed(error)).toBe(true);
    }
    expect(sheets).toEqual([{ reason: 'unreachable' }, { reason: 'unreachable' }]);
  });
});

describe('core/api in the standalone build', () => {
  afterEach(() => {
    globals.__BIFROST_BUILD__ = 'hub';
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('stubs every request: no fetch, a HubUnavailableError, the sheet, and a counted call', async () => {
    globals.__BIFROST_BUILD__ = 'standalone';
    vi.resetModules();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const bridge = await import('./bridge');
    const sheets: BridgeClosedRequest[] = [];
    bridge.onBridgeClosed((request) => sheets.push(request));
    const api = await import('./api');

    const error = await api.apiSend('POST', '/api/v1/runestone', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(api.HubUnavailableError);
    expect(api.isHubClosed(error)).toBe(true);
    await expect(api.apiGet('/api/v1/edda')).rejects.toBeInstanceOf(api.HubUnavailableError);

    expect(fetch).not.toHaveBeenCalled();
    expect(sheets).toEqual([{ reason: 'standalone' }, { reason: 'standalone' }]);
    expect(api.standaloneStubCalls()).toEqual(['apiSend', 'apiGet']);
    expect(globals.__bifrostStubCalls).toEqual(['apiSend', 'apiGet']);
  });

  it('stubs the document modules too, before any request is built', async () => {
    globals.__BIFROST_BUILD__ = 'standalone';
    vi.resetModules();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const runestone = await import('./runestone');
    const api = await import('./api');
    await expect(runestone.saveRunestone({ content: '{}' })).rejects.toBeInstanceOf(api.HubUnavailableError);
    await expect(runestone.fetchRunestone('x')).rejects.toBeInstanceOf(api.HubUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
    expect(api.standaloneStubCalls()).toEqual(['saveRunestone', 'fetchRunestone']);
  });
});
