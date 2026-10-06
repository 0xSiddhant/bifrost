import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../support/fixtures.js';
import { routeTagsInSpec, routesInAppSource } from '../support/journey.js';
import { fromRepoRoot } from '../support/paths.js';

/**
 * Coverage cannot rot silently: every route `App.tsx` declares must be tagged
 * by at least one journey, so a new page fails CI until it gets one. App.tsx is
 * read as **text** — the e2e workspace never imports product source.
 */
test('every client route in App.tsx has a journey', { tag: '@harness' }, async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'a source check: one project is enough');
  const appRoutes = routesInAppSource(
    fs.readFileSync(fromRepoRoot('client', 'src', 'app', 'App.tsx'), 'utf8'),
  );
  expect(appRoutes.length).toBeGreaterThan(30);

  const specDir = path.dirname(testInfo.file);
  const tagged = new Set<string>();
  for (const file of fs.readdirSync(specDir)) {
    if (!file.endsWith('.spec.ts')) continue;
    for (const tag of routeTagsInSpec(fs.readFileSync(path.join(specDir, file), 'utf8')))
      tagged.add(tag);
  }
  const untested = appRoutes.filter((route) => !tagged.has(route));
  expect(untested, `routes with no journey — add one tagged routes('<path>')`).toEqual([]);
});
