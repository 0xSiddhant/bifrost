// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { attachCodeCopyButtons } from '../markdown/codeCopy';
import { renderMarkdown } from '../markdown/render';
import { GUIDES, guideForRoute } from './registry';

describe('guideForRoute', () => {
  it.each([
    ['/runestone', 'json'],
    ['/edda', 'markdown'],
    ['/atlas', 'xml'],
    ['/groot', 'yaml'],
    ['/loki', 'javascript'],
    ['/brotli', 'brotli'],
  ])('%s resolves to the %s guide', (pathname, id) => {
    expect(guideForRoute(pathname)?.id).toBe(id);
  });

  it('gives a sub-route the guide of its root page', () => {
    // A saved document and the public preview page are the same format as the
    // editor they hang off.
    expect(guideForRoute('/runestone/my-doc')?.id).toBe('json');
    expect(guideForRoute('/edda/preview/notes')?.id).toBe('markdown');
    expect(guideForRoute('/groot/config')?.id).toBe('yaml');
  });

  it.each(['/', '/pensieve', '/variant', '/ollivanders', '/diagon-alley/qr', '/nimbus', '/saga'])(
    'has no guide for %s',
    (pathname) => {
      expect(guideForRoute(pathname)).toBeNull();
    },
  );

  it('matches on a whole path segment, not a bare string prefix', () => {
    // Without the segment check `/lokistuff` would inherit Loki's guide.
    expect(guideForRoute('/lokistuff')).toBeNull();
    expect(guideForRoute('/edda-drafts')).toBeNull();
  });

  it('gives every guide a distinct id and route', () => {
    expect(new Set(GUIDES.map((guide) => guide.id)).size).toBe(GUIDES.length);
    expect(new Set(GUIDES.map((guide) => guide.route)).size).toBe(GUIDES.length);
  });

  it('ships real markdown with at least one copyable example per guide', async () => {
    // The end of the whole chain, over the content that actually ships: the
    // loader reaches the file, the shared renderer turns its fence into the
    // <pre><code> shape the copy pass recognises, and a button lands on it.
    // Asserting on the markdown source instead would miss that brotli.md's
    // example is an unlabelled fence — still a code block, still copyable.
    for (const guide of GUIDES) {
      const markdown = await guide.load();
      expect(markdown.length).toBeGreaterThan(0);

      const container = document.createElement('div');
      container.innerHTML = renderMarkdown(markdown);
      attachCodeCopyButtons(container);

      expect(container.querySelectorAll('.md-copy').length).toBeGreaterThan(0);
    }
  });
});
