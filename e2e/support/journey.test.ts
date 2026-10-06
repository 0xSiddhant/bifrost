import { describe, expect, it } from 'vitest';
import { routeTagsInSpec, routes, routesInAppSource } from './journey.js';

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
