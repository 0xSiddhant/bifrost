import { describe, expect, it } from 'vitest';
import {
  featuresInSource,
  rootIsCovered,
  routeTagsInSpec,
  routes,
  routesInAppSource,
} from './journey.js';

describe('routesInAppSource', () => {
  it('joins nested relative children onto their parent and keeps self-closing routes flat', () => {
    const source = `
      <Routes>
        <Route path="/" element={<A />} />
        <Route path="/upload" element={<pages.UploadPage />}>
          <Route path=":name/preview" element={<pages.UploadPreviewModal />} />
        </Route>
        <Route path="/edda/:slug" element={<pages.EddaPage />} />
        <Route path="/sigil" element={<Navigate replace to="/diagon-alley/qr" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>`;
    expect(routesInAppSource(source)).toEqual([
      '/',
      '/upload',
      '/upload/:name/preview',
      '/edda/:slug',
      '/sigil',
      '*',
    ]);
  });
});

describe('route tags', () => {
  it('routes() tags each path for Playwright', () => {
    expect(routes('/edda/:slug', '*').tag).toEqual(['@route:/edda/:slug', '@route:*']);
  });

  it('routeTagsInSpec() reads the literals of every routes() call', () => {
    const spec =
      "test('a', routes('/edda/:slug', \"*\"), fn);\nconst r = routes(\n  '/upload',\n);\nother('/nope');";
    expect(routeTagsInSpec(spec)).toEqual(['/edda/:slug', '*', '/upload']);
  });
});

describe('featuresInSource (PLAN-35)', () => {
  const source = `
export const FEATURES: readonly Feature[] = [
  // Midgard
  { id: 'saga', label: 'Saga', roots: ['/saga'], category: 'midgard', needsHub: false },
  {
    id: 'clipboard',
    label: 'Hermes',
    roots: ['/hermes', '/muninn'],
    category: 'midgard',
    needsHub: true,
  },
  { id: 'guide', label: 'Guide', roots: [], category: null, needsHub: false },
];
`;

  it('reads each feature, one-line or spread over lines, with its roots and hub need', () => {
    expect(featuresInSource(source)).toEqual([
      { id: 'saga', roots: ['/saga'], needsHub: false },
      { id: 'clipboard', roots: ['/hermes', '/muninn'], needsHub: true },
      { id: 'guide', roots: [], needsHub: false },
    ]);
  });

  it('counts a root covered by itself or a route beneath it, not by a lookalike', () => {
    expect(rootIsCovered('/edda', ['/edda/:slug'])).toBe(true);
    expect(rootIsCovered('/edda', ['/edda'])).toBe(true);
    expect(rootIsCovered('/edda', ['/eddas'])).toBe(false);
  });
});
