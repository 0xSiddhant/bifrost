import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked, type Tokens } from 'marked';

/**
 * The one shared Markdown renderer (PLAN-11): marked with GFM, highlight.js on
 * fenced code, stable heading anchor ids, and DOMPurify always. Three surfaces
 * feed from this single pure function — the live preview, the public preview
 * page, and the HTML export — so there is zero drift between them.
 *
 * Sanitization is non-negotiable even on a trusted LAN: a saved edda can be
 * opened by any device, so an injected <script> must render inert everywhere.
 */

/** "My Heading!" → "my-heading"; matches the id the outline computes. */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * A dedup-aware heading slugger: the second "Intro" becomes "intro-1". Both the
 * renderer and the outline create one and call it per heading in document
 * order, so the ids they produce line up exactly (outline click → anchor).
 */
export function headingSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = slugifyHeading(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Build a fresh marked instance so options never bleed between renders. */
function buildMarked(slug: (text: string) => string): Marked {
  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token) {
        const inner = this.parser.parseInline(token.tokens ?? []);
        const id = slug(token.text);
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang ?? '').match(/\S*/)?.[0] ?? '';
        let highlighted: string;
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(token.text, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(token.text).value;
        }
        const cls = lang ? ` class="language-${escapeAttr(lang)}"` : '';
        return `<pre class="hljs"><code${cls}>${highlighted}</code></pre>\n`;
      },
    },
  });
  return instance;
}

export function renderMarkdown(md: string): string {
  const instance = buildMarked(headingSlugger());
  const html = instance.parse(md, { async: false });
  // DOMPurify keeps the ids/classes we emit but strips scripts, event handlers,
  // <style>, javascript: URLs, etc. Allow target so links can open in a new tab.
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'id'] });
}
