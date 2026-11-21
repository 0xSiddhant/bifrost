// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_COLLECTIONS } from '../assets/relics/collections';
import {
  getEnabledCollections,
  getSnowfallEnabled,
  onRelicPrefsChange,
  setEnabledCollections,
  setSnowfallEnabled,
} from './relicPrefs';

describe('sky prefs', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows every collection and lets snow fall when nothing is saved', () => {
    expect(getEnabledCollections()).toEqual([...ALL_COLLECTIONS]);
    expect(getSnowfallEnabled()).toBe(true);
  });

  it('keeps a saved relic choice exactly, a later collection unticked', () => {
    setEnabledCollections(['norse', 'ghibli']);
    expect(getEnabledCollections()).toEqual(['norse', 'ghibli']);
    setEnabledCollections([]);
    expect(getEnabledCollections()).toEqual([]);
  });

  it('remembers the Snowfall switch and announces each change', () => {
    const listener = vi.fn();
    const unsubscribe = onRelicPrefsChange(listener);

    setSnowfallEnabled(false);
    expect(getSnowfallEnabled()).toBe(false);
    expect(localStorage.getItem('bifrost.snowfall')).toBe('off');

    setSnowfallEnabled(true);
    expect(getSnowfallEnabled()).toBe(true);
    expect(localStorage.getItem('bifrost.snowfall')).toBeNull();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('falls back to the defaults when the store throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(getEnabledCollections()).toEqual([...ALL_COLLECTIONS]);
    expect(getSnowfallEnabled()).toBe(true);
    expect(() => setSnowfallEnabled(false)).not.toThrow();
    expect(() => setEnabledCollections([])).not.toThrow();
  });
});
