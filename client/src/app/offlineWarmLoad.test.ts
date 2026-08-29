import { describe, expect, it, vi } from 'vitest';
import { runWarmLoad, WARM_LOADERS, type WarmLoaders } from './offlineWarmLoad';
import { log } from '../core/log';

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
      ['atlas', 'edda', 'groot', 'loki', 'runestone', 'toolbox', 'variant'].sort(),
    );
  });
});
