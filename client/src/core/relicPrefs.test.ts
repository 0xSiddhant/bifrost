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

  it('keeps a saved relic choice exactly', () => {
    setEnabledCollections(['norse', 'ghibli']);
    expect(getEnabledCollections()).toEqual(['norse', 'ghibli']);
    setEnabledCollections([]);
    expect(getEnabledCollections()).toEqual([]);
  });

  it('stores what was unticked, so a collection added later shows for everyone', () => {
    setEnabledCollections(ALL_COLLECTIONS.filter((name) => name !== 'ghibli'));
    expect(localStorage.getItem('bifrost.relics.off')).toBe('["ghibli"]');
    // A device that saved before a collection existed has no word on it: on.
    localStorage.setItem('bifrost.relics.off', '["ghibli","no-such-collection"]');
    expect(getEnabledCollections()).toEqual(ALL_COLLECTIONS.filter((name) => name !== 'ghibli'));
  });

  it('keeps a sky switched off altogether empty, as collections are added', () => {
    setEnabledCollections([]);
    expect(localStorage.getItem('bifrost.relics.off')).toBe('["*"]');
    expect(getEnabledCollections()).toEqual([]);
    // An old choice with nothing ticked was an empty sky too: Yule does not appear in it.
    localStorage.clear();
    localStorage.setItem('bifrost.relics', '[]');
    expect(getEnabledCollections()).toEqual([]);
  });

  it('reads an old saved choice (the ticked ones) with every newer collection on, and replaces it', () => {
    // Saved before Yule existed: Olympus unticked, the rest ticked.
    localStorage.setItem('bifrost.relics', '["norse","wizarding","ghibli","halloween"]');
    expect(getEnabledCollections()).toEqual(['norse', 'wizarding', 'ghibli', 'halloween', 'yule']);
    setEnabledCollections(getEnabledCollections());
    expect(localStorage.getItem('bifrost.relics')).toBeNull();
    expect(localStorage.getItem('bifrost.relics.off')).toBe('["olympus"]');
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
