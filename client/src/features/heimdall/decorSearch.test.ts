import { describe, expect, it, vi } from 'vitest';

describe("Heimdall's season switches", () => {
  it('lists and finds a switchable decoration of whichever season is installed', async () => {
    vi.resetModules();
    const { installSeason } = await import('../../core/decor/registry');
    installSeason({
      id: 'fake',
      label: 'Fake',
      decorations: [
        {
          id: 'flurry',
          slot: 'sky',
          label: 'Flurry',
          description: 'Falls.',
          switchable: true,
          keywords: ['snow'],
        },
        { id: 'banner', slot: 'header', label: 'Banner', description: 'Hangs.', switchable: false },
      ],
      load: () => Promise.resolve({}),
    });
    const { searchSections } = await import('./search');
    const control = searchSections('snow').find((hit) => hit.controlId === 'decor-flurry');
    expect(control?.sectionId).toBe('relics');
    // A decoration without a switch has no control to find.
    expect(searchSections('banner').some((hit) => hit.controlId === 'decor-banner')).toBe(false);
  });
});
