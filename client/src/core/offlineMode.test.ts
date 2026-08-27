import { describe, expect, it } from 'vitest';
import { enabledTargets, targetLabel, type OfflineModeConfig } from './offlineMode';

const config: OfflineModeConfig = {
  targets: [
    { id: 'toolbox', label: 'Diagon Alley toolbox' },
    { id: 'runestone', label: 'Runestone (JSON)' },
    { id: 'loki', label: 'Loki (JS workbench)' },
  ],
  disabled: [],
};

describe('offline-mode policy (PLAN-22)', () => {
  it('warms every target when nothing is disabled', () => {
    expect(enabledTargets(config).map((target) => target.id)).toEqual([
      'toolbox',
      'runestone',
      'loki',
    ]);
  });

  it('drops the ids an admin has switched off, keeping registry order', () => {
    const narrowed = { ...config, disabled: ['loki', 'toolbox'] };
    expect(enabledTargets(narrowed).map((target) => target.id)).toEqual(['runestone']);
  });

  it('warms nothing when everything is disabled — a valid state, not an error', () => {
    const none = { ...config, disabled: ['toolbox', 'runestone', 'loki'] };
    expect(enabledTargets(none)).toEqual([]);
  });

  it('resolves labels for the pill, falling back to the id', () => {
    expect(targetLabel(config, 'loki')).toBe('Loki (JS workbench)');
    expect(targetLabel(config, 'unknown')).toBe('unknown');
  });
});
