// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, slugifyHeading, headingSlugger } from './render';

describe('renderMarkdown', () => {
  it('renders GFM: headings with ids, tables, task lists, strikethrough', () => {
    const html = renderMarkdown(
      '# Hello World\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~gone~~',
    );
    expect(html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/<del>gone<\/del>/);
  });

  it('highlights fenced code (highlight.js markup present)', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre class="hljs">');
    expect(html).toContain('language-js');
    expect(html).toContain('hljs-'); // at least one token class
  });

  it('neutralizes injected <script>', () => {
    const html = renderMarkdown('Hello\n\n<script>window.pwned = 1</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('window.pwned');
  });

  it('strips inline event handlers and javascript: URLs', () => {
    const html = renderMarkdown(
      '<img src="x" onerror="alert(1)">\n\n[click](javascript:alert(1))\n\n<a href="javascript:evil()">x</a>',
    );
    expect(html).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('drops <style> and raw event-handler attributes on allowed tags', () => {
    const html = renderMarkdown('<style>body{display:none}</style>\n\n<div onclick="x()">hi</div>');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('onclick');
  });
});

describe('slugifyHeading + headingSlugger', () => {
  it('slugifies punctuation and whitespace', () => {
    expect(slugifyHeading('  My Heading!  ')).toBe('my-heading');
    expect(slugifyHeading('Café & Bar')).toBe('caf-bar');
    expect(slugifyHeading('!!!')).toBe('section');
  });

  it('dedups repeated headings deterministically', () => {
    const slug = headingSlugger();
    expect(slug('Intro')).toBe('intro');
    expect(slug('Intro')).toBe('intro-1');
    expect(slug('Intro')).toBe('intro-2');
  });
});
