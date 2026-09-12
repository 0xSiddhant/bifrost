import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked, type Token, type Tokens } from 'marked';

/**
 * The one shared Markdown renderer (PLAN-11): marked with GFM, highlight.js on
 * fenced code, stable heading anchor ids, and DOMPurify always. Four surfaces
 * feed from this single pure function — the live preview, the public preview
 * page, the HTML/PDF export, and (since PLAN-20) the file-preview modal — so
 * there is zero drift between them.
 *
 * Sanitization is non-negotiable even on a trusted LAN: a saved edda can be
 * opened by any device, so an injected <script> must render inert everywhere.
 *
 * This function stays **pure and synchronous**, which is why a ```mermaid fence
 * only emits a placeholder here (PLAN-20). Mermaid is async and needs a live
 * DOM to measure text before it can lay a graph out; running it inside this
 * function would make it async and DOM-bound and break all four consumers at
 * once. `core/markdown/mermaid.ts` swaps the SVG in afterwards.
 */

/** The class the mermaid pass looks for; the fence's source is its text. */
export const MERMAID_PLACEHOLDER_CLASS = 'mermaid-src';

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

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A fence's language is the first word of its info string: "js", "mermaid", "". */
function fenceLang(info: string | undefined): string {
  return (info ?? '').match(/\S*/)?.[0]?.toLowerCase() ?? '';
}

/**
 * Does this document contain a diagram? The gate for the ~1 MB mermaid chunk,
 * so it has to agree exactly with what the renderer does — hence marked's own
 * lexer rather than a regex over the source. A fence inside a larger code
 * block, or the word "mermaid" in a sentence, is not a diagram.
 */
export function hasMermaid(md: string): boolean {
  // Children hang off different keys per token type — `tokens` for most,
  // `items` for a list, `header`/`rows` for a table — so the walk follows every
  // array of token-shaped objects rather than a fixed list of keys. Missing one
  // is not a cosmetic bug: it would leave a real diagram's placeholder on the
  // page with mermaid never loaded to fill it in.
  const walk = (nodes: unknown): boolean => {
    if (Array.isArray(nodes)) return nodes.some(walk);
    if (typeof nodes !== 'object' || nodes === null) return false;
    const token = nodes as Token;
    if (token.type === 'code') return fenceLang((token as Tokens.Code).lang) === 'mermaid';
    return Object.values(token).some((value) => Array.isArray(value) && walk(value));
  };
  return walk(new Marked({ gfm: true, breaks: false }).lexer(md));
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
        // The diagram placeholder: source in, SVG swapped in later by the
        // mermaid pass. Escaped, so an unrendered one is inert text.
        if (lang.toLowerCase() === 'mermaid') {
          return `<pre class="${MERMAID_PLACEHOLDER_CLASS}">${escapeText(token.text)}</pre>\n`;
        }
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
