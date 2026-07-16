import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getDeviceId', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is stable across calls and persists to localStorage', async () => {
    const { getDeviceId } = await import('./deviceId');
    const first = getDeviceId();
    expect(first).toBeTruthy();
    expect(getDeviceId()).toBe(first);
    expect(localStorage.getItem('bifrost.deviceId')).toBe(first);
  });

  it('reuses an id already in localStorage', async () => {
    localStorage.setItem('bifrost.deviceId', 'existing-id');
    const { getDeviceId } = await import('./deviceId');
    expect(getDeviceId()).toBe('existing-id');
  });
});
