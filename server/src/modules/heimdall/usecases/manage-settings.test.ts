import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../core/bus/index.js';
import { AppError } from '../../../core/http/index.js';
import type { HeimdallSettings, SettingsRepository } from '../ports.js';
import { GetSettingsUseCase, UpdateSettingsUseCase } from './manage-settings.js';

class FakeSettingsRepo implements SettingsRepository {
  store: Partial<HeimdallSettings> = {};
  read(): Partial<HeimdallSettings> {
    return { ...this.store };
  }
  update(patch: Partial<HeimdallSettings>): void {
    Object.assign(this.store, patch);
  }
}

const DEFAULTS: HeimdallSettings = {
  shortcut: 'shift+meta+comma',
  tapCount: 7,
  defaultThemeId: null,
};

function build() {
  const repo = new FakeSettingsRepo();
  const bus = new EventBus();
  const getSettings = new GetSettingsUseCase(repo, DEFAULTS);
  const update = new UpdateSettingsUseCase(repo, getSettings, bus);
  return { repo, bus, getSettings, update };
}

describe('GetSettingsUseCase', () => {
  it('falls back to defaults when the DB has no overlay', () => {
    const { getSettings } = build();
    expect(getSettings.execute()).toEqual(DEFAULTS);
  });

  it('prefers DB overlay values', () => {
    const { repo, getSettings } = build();
    repo.store = { tapCount: 9 };
    expect(getSettings.execute().tapCount).toBe(9);
  });
});

describe('UpdateSettingsUseCase', () => {
  it('normalizes and persists a valid shortcut, broadcasting the change', () => {
    const { update, repo, bus } = build();
    const listener = vi.fn();
    bus.on('settings.updated', listener);

    const result = update.execute({ shortcut: 'meta+shift+comma' });

    expect(result.shortcut).toBe('shift+meta+comma');
    expect(repo.store.shortcut).toBe('shift+meta+comma');
    expect(listener).toHaveBeenCalledWith({ shortcut: 'shift+meta+comma', tapCount: 7 });
  });

  it('rejects an invalid shortcut with a 400', () => {
    const { update } = build();
    expect(() => update.execute({ shortcut: 'justtext' })).toThrow(AppError);
  });

  it('rejects a reserved browser combo', () => {
    const { update } = build();
    expect(() => update.execute({ shortcut: 'meta+w' })).toThrow(/reserved/);
  });

  it('rejects an out-of-range tap count', () => {
    const { update } = build();
    expect(() => update.execute({ tapCount: 99 })).toThrow(/between 3 and 20|from 3 to 20/);
    expect(() => update.execute({ tapCount: 2 })).toThrow(AppError);
  });

  it('accepts and stores a default theme id', () => {
    const { update, repo } = build();
    update.execute({ defaultThemeId: 'aurora' });
    expect(repo.store.defaultThemeId).toBe('aurora');
  });
});
