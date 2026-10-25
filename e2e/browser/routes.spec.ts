import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../support/fixtures.js';
import {
  featuresInSource,
  rootIsCovered,
  routeTagsInSpec,
  routesInAppSource,
} from '../support/journey.js';
import { fromRepoRoot } from '../support/paths.js';

/**
 * Coverage cannot rot silently: every route `App.tsx` declares must be tagged
 * by at least one journey, so a new page fails CI until it gets one. And every
 * URL root `core/features.ts` declares (PLAN-35) must be journeyed in each
 * build that ships it: all of them by the hub journeys, the `needsHub: false`
 * ones by the standalone journeys too. Product source is read as **text** —
 * the e2e workspace never imports it.
 */

function tagsIn(dir: string): Set<string> {
  const tagged = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.spec.ts')) continue;
    for (const tag of routeTagsInSpec(fs.readFileSync(path.join(dir, file), 'utf8')))
      tagged.add(tag);
  }
  return tagged;
}

test.describe('route coverage', { tag: '@harness' }, () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'a source check: one project is enough',
    );
  });

  test('every client route in App.tsx has a journey', async ({}, testInfo) => {
    const appRoutes = routesInAppSource(
      fs.readFileSync(fromRepoRoot('client', 'src', 'app', 'App.tsx'), 'utf8'),
    );
    expect(appRoutes.length).toBeGreaterThan(30);
    const tagged = tagsIn(path.dirname(testInfo.file));
    const untested = appRoutes.filter((route) => !tagged.has(route));
    expect(untested, `routes with no journey — add one tagged routes('<path>')`).toEqual([]);
  });

  test('every feature root has a journey in each build that ships it', async ({}, testInfo) => {
    const features = featuresInSource(
      fs.readFileSync(fromRepoRoot('client', 'src', 'core', 'features.ts'), 'utf8'),
    );
    expect(features.length).toBeGreaterThan(15);
    const hubTags = tagsIn(path.dirname(testInfo.file));
    const standaloneTags = tagsIn(fromRepoRoot('e2e', 'standalone'));

    const roots = features.flatMap((feature) => feature.roots);
    expect(
      roots.filter((root) => !rootIsCovered(root, hubTags)),
      'hub: feature roots with no journey',
    ).toEqual([]);
    const standaloneRoots = features
      .filter((feature) => !feature.needsHub)
      .flatMap((feature) => feature.roots);
    expect(standaloneRoots.length).toBeGreaterThan(5);
    expect(
      standaloneRoots.filter((root) => !rootIsCovered(root, standaloneTags)),
      'standalone: feature roots with no journey in e2e/standalone/',
    ).toEqual([]);
  });
});
