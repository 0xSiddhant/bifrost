import { afterEach, describe, expect, it, vi } from 'vitest';

/** PLAN-35: which Heimdall sections each build carries. */
const globals = globalThis as { __BIFROST_BUILD__?: string };

async function sectionIds(build: 'hub' | 'standalone'): Promise<string[]> {
  globals.__BIFROST_BUILD__ = build;
  vi.resetModules();
  const { SECTIONS } = await import('./sections');
  return SECTIONS.map((section) => section.id);
}

afterEach(() => {
  globals.__BIFROST_BUILD__ = 'hub';
  vi.resetModules();
});

describe('Heimdall sections per build', () => {
  it('keeps every hub section, and no Themes section', async () => {
    expect(await sectionIds('hub')).toEqual([
      'overview',
      'activity',
      'wardens',
      'settings',
      'relics',
      'loki',
      'nott',
      'offline-mode',
      'storage',
      'uploads',
      'network',
      'about',
    ]);
  });

  it('carries only the device-local sections standalone', async () => {
    expect(await sectionIds('standalone')).toEqual(['settings', 'relics', 'loki', 'nott', 'about']);
  });

  it('offers no default theme or session revoke standalone', async () => {
    globals.__BIFROST_BUILD__ = 'standalone';
    vi.resetModules();
    const { SECTIONS } = await import('./sections');
    const controls = SECTIONS.find((section) => section.id === 'settings')?.manifest.map(
      (item) => item.controlId,
    );
    expect(controls).toEqual(['browser-theme', 'shortcut', 'tap-count']);
  });
});
