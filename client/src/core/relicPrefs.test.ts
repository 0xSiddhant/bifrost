// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_COLLECTIONS } from '../assets/relics/collections';
import { getEnabledCollections, onRelicPrefsChange, setEnabledCollections } from './relicPrefs';

describe('relic prefs', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows every collection when nothing is saved', () => {
    expect(getEnabledCollections()).toEqual([...ALL_COLLECTIONS]);
  });

  it('keeps a saved relic choice exactly, a later collection unticked', () => {
    setEnabledCollections(['norse', 'ghibli']);
    expect(getEnabledCollections()).toEqual(['norse', 'ghibli']);
    setEnabledCollections([]);
    expect(getEnabledCollections()).toEqual([]);
  });

  it('announces each change', () => {
    const listener = vi.fn();
    const unsubscribe = onRelicPrefsChange(listener);
    setEnabledCollections(['norse']);
    expect(listener).toHaveBeenCalledTimes(1);
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
    expect(() => setEnabledCollections([])).not.toThrow();
  });
});
