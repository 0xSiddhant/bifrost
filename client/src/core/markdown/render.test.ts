// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, slugifyHeading, headingSlugger, hasMermaid } from './render';

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

describe('mermaid fences (PLAN-20)', () => {
  it('emits an escaped placeholder instead of a highlighted code block', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A["<b>x</b>"] --> B\n```');
    expect(html).toContain('<pre class="mermaid-src">');
    expect(html).not.toContain('hljs');
    // Escaped, so an unrendered placeholder is inert text — and reading the
    // node's textContent gives the mermaid source back byte for byte.
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('pre.mermaid-src')?.textContent).toBe(
      'graph TD\n  A["<b>x</b>"] --> B',
    );
  });

  it('survives DOMPurify with its class and source intact', () => {
    // renderMarkdown sanitizes on the way out, so this asserts the real path.
    const html = renderMarkdown('```mermaid\nsequenceDiagram\n  A->>B: hi\n```');
    expect(html).toMatch(/<pre class="mermaid-src">sequenceDiagram\n {2}A-&gt;&gt;B: hi<\/pre>/);
  });

  it('leaves other fences highlighted', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre class="hljs">');
    expect(html).not.toContain('mermaid-src');
  });

  it('accepts an info string with extra words and any case', () => {
    expect(renderMarkdown('```Mermaid  title=x\ngraph TD\n A-->B\n```')).toContain('mermaid-src');
  });
});

describe('hasMermaid', () => {
  it('is true only for a real mermaid fence', () => {
    expect(hasMermaid('```mermaid\ngraph TD\n A-->B\n```')).toBe(true);
    expect(hasMermaid('~~~mermaid\ngraph TD\n A-->B\n~~~')).toBe(true);
    expect(hasMermaid('```mermaid theme=dark\ngraph TD\n A-->B\n```')).toBe(true);
    expect(hasMermaid('```MERMAID\ngraph TD\n A-->B\n```')).toBe(true);
    // Indented under a list item is still a fence.
    expect(hasMermaid('- item\n\n  ```mermaid\n  graph TD\n  ```')).toBe(true);
    expect(hasMermaid('> ```mermaid\n> graph TD\n> ```')).toBe(true);
  });

  it('is false for prose, other fences, and a fence quoted inside a code block', () => {
    expect(hasMermaid('')).toBe(false);
    expect(hasMermaid('I drew this in mermaid, honest.')).toBe(false);
    expect(hasMermaid('`mermaid`')).toBe(false);
    expect(hasMermaid('```js\nconst mermaid = 1;\n```')).toBe(false);
    // The gate has to agree with the renderer, and the renderer treats this
    // outer fence as one code block whose text merely mentions mermaid.
    expect(hasMermaid('````\n```mermaid\ngraph TD\n```\n````')).toBe(false);
    expect(hasMermaid('    ```mermaid\n    graph TD\n    ```')).toBe(false);
  });

  it('agrees with what renderMarkdown actually emits', () => {
    const corpus = [
      '```mermaid\ngraph TD\n A-->B\n```',
      '# hi\n\ntext\n\n```mermaid\npie\n```\n\nmore',
      '```js\nx\n```',
      'plain mermaid words',
      '````\n```mermaid\n```\n````',
      '- a\n\n  ```mermaid\n  graph TD\n  ```',
    ];
    for (const md of corpus) {
      expect(hasMermaid(md), md).toBe(renderMarkdown(md).includes('class="mermaid-src"'));
    }
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
