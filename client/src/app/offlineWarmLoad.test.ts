import { describe, expect, it, vi } from 'vitest';
import {
  runOfflineWarmLoad,
  runWarmLoad,
  SHELL_WARM_LOADERS,
  WARM_LOADERS,
  type WarmLoaders,
} from './offlineWarmLoad';
import { guidePanelChunk } from '../core/guide/GuideButton';
import { GUIDES } from '../core/guide/registry';
import { log } from '../core/log';
import { targetLabel, type OfflineModeConfig } from '../core/offlineMode';

const loaders = (failing: string[] = []): WarmLoaders => ({
  toolbox: () =>
    failing.includes('toolbox') ? Promise.reject(new Error('chunk 404')) : Promise.resolve({}),
  runestone: () =>
    failing.includes('runestone') ? Promise.reject(new Error('chunk 404')) : Promise.resolve({}),
  loki: () =>
    failing.includes('loki') ? Promise.reject(new Error('chunk 404')) : Promise.resolve({}),
});

describe('runWarmLoad (PLAN-22)', () => {
  it('resolves every requested target', async () => {
    const result = await runWarmLoad(['toolbox', 'runestone', 'loki'], loaders());
    expect(result).toEqual({ loaded: ['toolbox', 'runestone', 'loki'], failed: [] });
  });

  it('warms only the subset it was given', async () => {
    const map = loaders();
    const spy = vi.spyOn(map, 'loki');
    const result = await runWarmLoad(['toolbox'], map);
    expect(result.loaded).toEqual(['toolbox']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('lets one failure through without cancelling the others, and names it', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const result = await runWarmLoad(['toolbox', 'runestone', 'loki'], loaders(['runestone']));
    expect(result.loaded).toEqual(['toolbox', 'loki']);
    expect(result.failed).toEqual(['runestone']);
    // A rejection the pill reports as "Partly ready" is still a real failure.
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0] as [string])[0]).toContain('runestone');
    warn.mockRestore();
  });

  it('reports an id this build has no loader for instead of silently skipping', async () => {
    // A deliberately fictional id: `atlas` stood here until PLAN-23 shipped it
    // and turned this into a test of a real page.
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const result = await runWarmLoad(['toolbox', 'mimir'], loaders());
    expect(result).toEqual({ loaded: ['toolbox'], failed: [] });
    expect((warn.mock.calls[0] as [string])[0]).toContain('mimir');
    warn.mockRestore();
  });

  it('empty in, empty out', async () => {
    expect(await runWarmLoad([], loaders())).toEqual({ loaded: [], failed: [] });
  });

  it('ships a loader for every id the server registry advertises', () => {
    // The two lists are joined by id at runtime; nothing else checks they agree.
    expect(Object.keys(WARM_LOADERS).sort()).toEqual(
      [
        'atlas',
        'edda',
        'groot',
        'loki',
        'runestone',
        'saga',
        'screensaver',
        'toolbox',
        'variant',
      ].sort(),
    );
  });
});

// PLAN-40: the Guide panel left the entry chunk, so the shell warms it itself.
describe('runOfflineWarmLoad', () => {
  /** A policy as the server sends it: no Guide entry, whatever an admin does. */
  const policy: OfflineModeConfig = {
    targets: [
      { id: 'toolbox', label: 'Diagon Alley tools' },
      { id: 'runestone', label: 'Runestone' },
    ],
    disabled: [],
  };

  it('warms the Guide panel and every guide text on an arm whose policy names no Guide', async () => {
    const panel = vi.spyOn(guidePanelChunk, 'load').mockResolvedValue({} as never);
    const texts = GUIDES.map((guide) => vi.spyOn(guide, 'load').mockResolvedValue(''));

    const result = await runOfflineWarmLoad(['toolbox', 'runestone'], loaders());

    expect(panel).toHaveBeenCalledTimes(1);
    for (const text of texts) expect(text).toHaveBeenCalledTimes(1);
    expect(texts).toHaveLength(6);
    // Counted once in the pill, beside the policy's own targets.
    expect(result).toEqual({ loaded: ['toolbox', 'runestone', 'Guide'], failed: [] });
    vi.restoreAllMocks();
  });

  it('warms it even when an admin has disabled every policy target', async () => {
    const panel = vi.spyOn(guidePanelChunk, 'load').mockResolvedValue({} as never);
    for (const guide of GUIDES) vi.spyOn(guide, 'load').mockResolvedValue('');

    const result = await runOfflineWarmLoad([], loaders());

    expect(panel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ loaded: ['Guide'], failed: [] });
    vi.restoreAllMocks();
  });

  it('reports a failed shell load in the same status, labelled Guide', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await runOfflineWarmLoad(['toolbox'], loaders(), {
      Guide: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
    });

    expect(result).toEqual({ loaded: ['toolbox'], failed: ['Guide'] });
    // The server's registry does not name it, so the label falls back to the id.
    expect(result.failed.map((id) => targetLabel(policy, id))).toEqual(['Guide']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('keeps the shell ids out of the server registry ids', () => {
    for (const id of Object.keys(SHELL_WARM_LOADERS)) expect(WARM_LOADERS).not.toHaveProperty(id);
  });
});
