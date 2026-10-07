// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSettingsStore, migrate } from './store';

vi.mock('../log', () => ({ log: { warn: vi.fn() } }));

/**
 * PLAN-35 criterion 16: the standalone site's settings persist per browser,
 * sync across tabs, and survive whatever `localStorage` hands back.
 */
const KEY = 'bifrost.local.screensaver';

const DEFAULTS = {
  enabled: true,
  idleSeconds: 120,
  density: 'medium' as 'low' | 'medium' | 'high',
  motion: 'normal' as 'calm' | 'normal' | 'lively',
  connectLines: true,
  mouseReactive: true,
  showQuotes: true,
  quoteRotateSeconds: 12,
  idleMin: 5,
  idleMax: 3600,
};

const store = () => new LocalSettingsStore('screensaver', DEFAULTS);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocalSettingsStore', () => {
  it('starts from the build-time defaults when nothing is stored', async () => {
    expect(await store().load()).toEqual(DEFAULTS);
  });

  it('round-trips a save through localStorage, in the v1 envelope', async () => {
    const saved = await store().save({ idleSeconds: 300, density: 'high' });
    expect(saved).toMatchObject({ idleSeconds: 300, density: 'high' });
    expect(await store().load()).toEqual(saved);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual({ v: 1, values: saved });
  });

  it('refuses an out-of-range save field by field, keeping the rest', async () => {
    const saved = await store().save({ idleSeconds: 2, motion: 'calm' });
    expect(saved.idleSeconds).toBe(DEFAULTS.idleSeconds);
    expect(saved.motion).toBe('calm');
  });

  it('falls back to every default for corrupted JSON', async () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(await store().load()).toEqual(DEFAULTS);
  });

  it('falls back per field for hand-edited and out-of-range values', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        values: { idleSeconds: 99999, density: 'extreme', motion: 'lively', idleMin: 0 },
      }),
    );
    expect(await store().load()).toEqual({ ...DEFAULTS, motion: 'lively' });
  });

  it('treats an unversioned (old-format) value as nothing stored', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ idleSeconds: 300 }));
    expect(await store().load()).toEqual(DEFAULTS);
  });

  it('uses the defaults, without crashing, when localStorage throws (Safari private mode)', async () => {
    const broken = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const throwing = new LocalSettingsStore('screensaver', DEFAULTS, broken);
    expect(await throwing.load()).toEqual(DEFAULTS);
    expect(await throwing.save({ idleSeconds: 300 })).toMatchObject({ idleSeconds: 300 });
  });

  it('keeps a second instance (another tab) in step through the storage event', async () => {
    const other = store();
    const listener = vi.fn();
    const off = other.subscribe(listener);
    await store().save({ showQuotes: false });
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ showQuotes: false }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'bifrost.local.loki' }));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('migrate (the versioned envelope)', () => {
  it('unwraps v1', () => {
    expect(migrate({ v: 1, values: { a: 1 } })).toEqual({ a: 1 });
  });

  it('drops anything unversioned or from a future version rather than misreading it', () => {
    expect(migrate({ v: 2, values: { a: 1 } })).toBeNull();
    expect(migrate({ a: 1 })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate('v1')).toBeNull();
  });
});
