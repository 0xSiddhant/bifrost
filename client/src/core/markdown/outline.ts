import { marked } from 'marked';
import { headingSlugger } from './render';

/** One heading in the document outline. */
export interface OutlineItem {
  /** 1–6. */
  depth: number;
  /** Display text with inline markdown markers stripped. */
  text: string;
  /** Anchor id — identical to the id renderMarkdown emits for this heading. */
  id: string;
  /** Byte-ish source offset of the heading (for the editor jump). */
  offset: number;
}

/** Strip the common inline markers so the outline reads as plain prose. */
function plainInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images → their label
    .replace(/[*_`~]/g, '')
    .trim();
}

/**
 * Heading tree parsed from the same lexer the renderer uses, so anchor ids
 * match. Offsets come from summing token `raw` lengths in document order —
 * approximate but stable, which is all the editor jump needs.
 */
export function outline(md: string): OutlineItem[] {
  const slug = headingSlugger();
  const tokens = marked.lexer(md);
  const items: OutlineItem[] = [];
  let offset = 0;
  for (const token of tokens) {
    if (token.type === 'heading') {
      items.push({
        depth: token.depth,
        text: plainInline(token.text),
        id: slug(token.text),
        offset,
      });
    }
    offset += token.raw.length;
  }
  return items;
}
