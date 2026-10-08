import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURES, HUB_FEATURES, STANDALONE_FEATURES, needsHubForPath } from './features';

/** The first segment of every `<Route path="…">` in App.tsx, read as text. */
function appRouteRoots(): string[] {
  const source = readFileSync(new URL('../app/App.tsx', import.meta.url), 'utf8');
  const roots = [...source.matchAll(/<Route\s+path="(\/[^"]*)"/g)].map(
    ([, path]) => `/${(path ?? '/').split('/')[1] ?? ''}`,
  );
  return [...new Set(roots)];
}

/** The category hubs themselves: pages of cards, not features. */
const HUB_PAGES = new Set(['/', '/ollivanders']);

describe('the feature manifest', () => {
  it('ships every feature in the hub build and only the hub-free ones standalone', () => {
    expect(HUB_FEATURES).toEqual(FEATURES);
    expect(STANDALONE_FEATURES.map((feature) => feature.id)).toEqual(
      FEATURES.filter((feature) => !feature.needsHub).map((feature) => feature.id),
    );
    expect(STANDALONE_FEATURES.map((feature) => feature.id).sort()).toEqual(
      ['atlas', 'edda', 'groot', 'guide', 'loki', 'runestone', 'saga', 'toolbox', 'variant'].sort(),
    );
  });

  it('gives every route root in App.tsx exactly one feature', () => {
    const roots = appRouteRoots().filter((root) => !HUB_PAGES.has(root));
    expect(roots.length).toBeGreaterThan(10);
    for (const root of roots) {
      const owners = FEATURES.filter((feature) => feature.roots.includes(root));
      expect(
        owners.map((owner) => owner.id),
        root,
      ).toHaveLength(1);
    }
  });

  it('names no root App.tsx does not route', () => {
    const routed = new Set(appRouteRoots());
    for (const feature of FEATURES) {
      for (const root of feature.roots)
        expect(routed.has(root), `${feature.id} ${root}`).toBe(true);
    }
  });
});

describe('needsHubForPath', () => {
  afterEach(() => {
    (globalThis as { __BIFROST_BUILD__?: string }).__BIFROST_BUILD__ = 'hub';
    vi.resetModules();
  });

  it('flags server paths in either build', () => {
    for (const path of ['/api', '/api/health', '/go/wiki', '/runestone/api/x', '/atlas/api/y']) {
      expect(needsHubForPath(path), path).toBe(true);
    }
    expect(needsHubForPath('/runestone')).toBe(false);
    expect(needsHubForPath('/apiary')).toBe(false);
  });

  it('flags the hub-only pages only in the standalone build', async () => {
    expect(needsHubForPath('/hermes')).toBe(false);
    (globalThis as { __BIFROST_BUILD__?: string }).__BIFROST_BUILD__ = 'standalone';
    vi.resetModules();
    const standalone = await import('./features');
    expect(standalone.hasFeature('clipboard')).toBe(false);
    for (const path of [
      '/hermes',
      '/muninn',
      '/upload',
      '/downloads/x/preview',
      '/pensieve',
      '/brotli',
      '/wardens',
      '/nimbus',
    ]) {
      expect(standalone.needsHubForPath(path), path).toBe(true);
    }
    for (const path of ['/runestone', '/edda', '/saga', '/diagon-alley/qr', '/loki', '/variant']) {
      expect(standalone.needsHubForPath(path), path).toBe(false);
    }
  });
});
