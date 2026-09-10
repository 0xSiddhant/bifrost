/**
 * Markdown → slides (PLAN-28).
 *
 * Two raw-text passes over the document before anything is rendered, which is
 * the same shape `core/markdown`'s own `outline.ts`/`stats.ts` already use: the
 * split, and the per-slide notes extraction. Neither touches `renderMarkdown` —
 * each slide's body is handed to it unchanged afterwards, so Saga stays the
 * fourth consumer of that one pipeline rather than a second implementation.
 */

export interface Slide {
  /** The slide's markdown, notes comment removed, outer blank lines trimmed. */
  body: string;
  /** The `<!-- notes: ... -->` text, or null when the slide carries none. */
  notes: string | null;
}

/**
 * A `---` alone on its own line, with optional surrounding whitespace. Three or
 * more dashes, matching what CommonMark itself treats as a thematic break.
 */
const BREAK = /^\s*-{3,}\s*$/;

/**
 * `<!-- notes: ... -->`, case-insensitive on the keyword and spanning lines.
 * Non-greedy so two comments in one slide stay two matches rather than one that
 * swallows everything between them.
 */
const NOTES = /<!--\s*notes:\s*([\s\S]*?)-->/gi;

/**
 * Pull every notes comment out of a slide and return the body without them.
 *
 * `renderMarkdown` would already drop an HTML comment from the visible output
 * on its own — this exists to *read* the note, not to hide it, and stripping it
 * here is what keeps the two facts (shown in the panel, absent from the body)
 * from depending on DOMPurify's comment handling staying what it is today.
 */
function extractNotes(text: string): { body: string; notes: string | null } {
  const found: string[] = [];
  const body = text.replace(NOTES, (_match, note: string) => {
    const trimmed = note.trim();
    if (trimmed) found.push(trimmed);
    return '';
  });
  return { body: body.trim(), notes: found.length > 0 ? found.join('\n\n') : null };
}

/**
 * Split a document into slides.
 *
 * A `---` on the document's **very first line** does not split: a deck that
 * opens with front-matter-shaped fencing would otherwise produce an empty
 * leading slide, which reads as a bug in the middle of a presentation. Every
 * later `---` line splits.
 *
 * **Known, accepted caveat**: a `---` inside a fenced code block splits too.
 * Fixing it needs a fence-aware scanner tracking open/close state across the
 * whole document, for a case that is rare in practice — deckrun has the same
 * documented caveat. `parseSlides.test.ts` pins the behaviour as it is rather
 * than leaving it to be rediscovered as a defect.
 *
 * An empty document, or one that is only breaks and whitespace, yields no
 * slides at all — the caller shows its own empty state rather than presenting
 * a blank frame.
 */
export function parseSlides(markdown: string): Slide[] {
  const lines = markdown.split(/\r?\n/);
  const chunks: string[][] = [[]];

  lines.forEach((line, index) => {
    if (index > 0 && BREAK.test(line)) {
      chunks.push([]);
      return;
    }
    chunks[chunks.length - 1]?.push(line);
  });

  return chunks
    .map((chunk) => extractNotes(chunk.join('\n')))
    .filter((slide) => slide.body.length > 0 || slide.notes !== null);
}
